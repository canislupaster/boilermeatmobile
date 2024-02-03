import AsyncStorage from "@react-native-async-storage/async-storage"
import * as Location from "expo-location"
import * as Linking from "expo-linking"
import React from "react"
import {encode, decode} from "base-64"
import * as SecureStore from 'expo-secure-store';
import { API_ROOT, DiningCourt, ServerError, ServerErrorResponse, UserInfo, Auth, WSServerMessage, WS_URL, send, ServerUserInfo, UserWhere, Key, UPDATE_LIMIT } from "./servertypes";
import { isRunning, sendToFriends, start, stop } from "./tasks";
import { KEYTYPE_EC, keyPair64, secureMessageDecrypt64 } from "react-native-themis"

type CallbackError = ServerErrorResponse | {err: "permNotGranted", message: string|null};

export type SearchState = {
  query: string,
  result?: { id: string, username: string }
};

export type UserMap = Record<string, UserInfo>

export type Page = "Courts" | "Users";

export type UIState = {
  page: Page,
  collapsedCourts: string[]
};

export type NormalState = {
  type: "normal",
  self: UserInfo,
  background: boolean,
  hasBackgroundLocationPermission: boolean,
  users: UserMap,
  search: SearchState,
  ws: WebSocket,
  wsDisconnectRetry?: number,
  courts: DiningCourt[],
  key: Key,
  friendKeys: Record<string,string>,
  ui: UIState
};

export type AppRequest =
  | { type: "load" }
  | { type: "reset" }
  | { type: "setUI", ui: UIState }
  | { type: "quit" }
  | { type: "start" }
  | { type: "stop" }
  | { type: "resetKey" }
  | { type: "search", name: string }
  | { type: "register", email: string, send: boolean }
  | { type: "verify", url: Linking.ParsedURL }
  | { type: "setname", name: string }
  | { type: "add", id: string }
  | { type: "remove", id: string, both: boolean }
  
export type AppStatus =
  { type: "registering" }
  | { type: "verifying", id: string, name: string|null, badCode: boolean }
  | { type: "naming", key: Key }
  | { type: "needResetKey", name: string|null, hasLocalKey: boolean }
  | NormalState

export type AppState = {
  loading: boolean,
  busy: boolean,
  handleError: (title: string, body: string) => void,
  auth?: Auth,
  status: AppStatus
}
  
export type SetAppState = (cb: (state: AppState) => AppState) => void;

//something to throw when server error has been handled but still need early exit
class HandledServerError extends Error {
  constructor() {
    super();
    Object.setPrototypeOf(this, HandledServerError.prototype);
  }
}

//ideally i would have stores with their own reducers, but the complexity is not worth it... just keep track of invariants instead
export const BAD_STATE = new Error("bad state");

//userinfo but string instead of date, using typescript to override type
async function toUser(privateKey: string, courts: DiningCourt[], x: ServerUserInfo): Promise<UserInfo> {
  if (x.where!==null) {
    let where: UserWhere|null=null;

    try {
      const msg = await secureMessageDecrypt64(x.where, privateKey, x.pubKey);
      let obj = JSON.parse(msg);

      if (obj.where===undefined || obj.floor===undefined || obj.since===undefined)
        throw "no where/floor/since";
      let court = courts.find((c) => c.name===obj.where);
      if (court===undefined) throw "court not found";
      if (obj.floor!==null && court.floors.find((x) => x.name===obj.floor)==undefined)
        throw "floor not found";

      const up = new Date(obj.updated);
      if (Date.now()-up.getTime() <= UPDATE_LIMIT) where = {
        where: obj.where,
        floor: obj.floor,
        since: new Date(obj.since),
        updated: up
      };
    } catch (e) {
      //really terrible error handling, but it would suck to alert the user whenever this happens
      //maybe later, add a flag on userinfo if failed parsing, which is probably due to bad keys
      console.error("couldnt decrypt/parse user where", e, x);
    }

    return {...x, where };
  } else {
    return {...x, where: null};
  }
}

export async function dispatch(req: AppRequest, state: AppState, setState: SetAppState, callback?: (err?: CallbackError) => boolean): Promise<void> {
  if (state.busy) {
    console.error("dispatch called while busy");
    return;
  }

  const stat = state.status;

  let raise = (title: string, body: string) => {
    state.handleError(title, body);
  };
  
  setState((state) => ({
    ...state,
    busy: true,
    loading:
      req.type=="setname" || req.type=="load"
      || req.type=="verify" || req.type=="register"
      || req.type=="search" || req.type=="add"
      || req.type=="remove"
      || (req.type=="start" && stat.type=="normal" && !stat.hasBackgroundLocationPermission)
  }));
  
  let setNState = (cb: (state: NormalState) => NormalState) => setState((s) => {
    if (s.status.type!=="normal") {
      console.log("abnormal state after request, probably logged out via socket or something...");

      return s;
    }

    return {...s, status: cb(s.status)};
  });
  
  let doReq = async (data: any, path: string, auth=state.auth) => {
    let res: any = null;
    try {
      res = await send(data, path, auth);
    } catch (e) {
      if (e instanceof ServerError) {
        if (callback===undefined || callback(e.err)) switch (req.type) {
          case "search": if (e.err.err=="userNotFound") {
            setNState((x) => ({...x, search: {...x.search, result: undefined}}))
            break;
          }
          default: 
            if (state.status.type=="verifying" && e.err.err=="badToken") {
              setState((x) => ({...x, status: {...x.status, badCode: true}}));
            } else if (e.err.err=="badToken" || e.err.err=="expired") {
              raise("Session expired", "Please log in again");
              setState((x) => ({...x, status: {type: "registering"}}));
            } else {
              raise("Error", e.message);
            }
        }
      } else {
        raise("Network error", (e as any).toString());
        throw new HandledServerError();
      }

      throw new HandledServerError();
    }
    
    return res;
  };
  
  let getUsers = async (privateKey: string, courts: DiningCourt[], users: ServerUserInfo[], id: string) => ({
    self: users.find((u: any) => u.id == id) as UserInfo, //where is guaranteed to be null from server
    users: Object.fromEntries(await Promise.all(users.filter((u: any) => u.id!=id)
      .map(async (x) => [x.id, await toUser(privateKey, courts, x)])))
  });
  
  let makeWs = (privateKey: string, courts: DiningCourt[], auth: Auth) => {
    let ws = new WebSocket(WS_URL.href);
    
    let restart = () => {
      setState((x) => {
        if (x.status.type != "normal" || x.status.ws != ws) return x;

        let retry = window.setTimeout(() => {
          console.log("retrying websocket connection");

          setState((y) => ({...y, status: {
            ...y.status,
            ws: makeWs(privateKey, courts, auth),
            wsDisconnectRetry: undefined
          }}));
        }, 500);

        return { ...x, status: { ...x.status, wsDisconnectRetry: retry } };
      });
    };

    ws.addEventListener("error", (e) => {
      console.error("websocket error", e);
      restart();
    });

    ws.addEventListener("close", (e) => {
      console.log("websocket closed");
      restart();
    });

    ws.addEventListener("message", (e) => (async () => {
      console.log("websocket event", e);
      const msg = JSON.parse(e.data) as WSServerMessage;
      console.log("websocket message", msg);

      switch (msg.type) {
        case "add":
        case "update":
          toUser(privateKey, courts, msg.info).then((u) =>
            setNState((y) => ({...y, users: {...y.users, [msg.info.id]: u}})))
            .catch(console.error); //private key doesnt work -> message could just be bad

          break;
        case "remove":
          setNState((x) => {
            const cpy = {...x, users: {...x.users}};
            delete cpy.users[msg.id];
            return cpy;
          });

          await setFriendObj((r) => {
            delete r[msg.id];
            return r;
          });

          break;
        case "error":
          switch (msg.err) {
            case "badToken":
            case "expired":
            case "disconnect": {
              raise(msg.err == "disconnect" ? "Disconnected from server" : "Authentication failed",
                msg.message ?? "Try logging in again");
              setState((x) => ({ ...x, status: { type: "registering" } }))
              break;
            }
            default:
              raise("Error", msg.message);
          }
      }
    })().catch((e) =>
      raise("Websocket error", e.toString())
    ));

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify(auth));
    });
    
    return ws;
  };

  let whereCb = (nw: UserWhere|null) => {
    setNState((x) => ({...x, self: {...x.self, where: nw}}));
  };

  let makeNormalState = async (auth: Auth, key: Key, users: ServerUserInfo[]): Promise<NormalState> => {
    const [ui, fkeys] = await AsyncStorage.multiGet(["uiState", "friendKeys"]);
    let friendKeys = fkeys[1]==null ? {} : JSON.parse(fkeys[1]);

    //cull keys of friends that removed us while app is offline
    for (let k in Object.keys(friendKeys)) {
      if (users.find((x) => x.id==k)==undefined)
        delete friendKeys[k];
    }

    await AsyncStorage.setItem("friendKeys", JSON.stringify(friendKeys));

    const courts = await doReq({}, "courts") as DiningCourt[];
    const running = await isRunning();
    const hasPerm = (await Location.getForegroundPermissionsAsync()).granted
      && (await Location.getBackgroundPermissionsAsync()).granted;
    
    if (running && hasPerm) await start(courts, whereCb);

    return {
      type: "normal",
      background: running,
      key, friendKeys,
      hasBackgroundLocationPermission: hasPerm,
      search: {query: "", result: undefined},
      ws: makeWs(key.private64, courts, auth),
      courts: courts,
      ui: ui[1]===null ? {page: "Courts", collapsedCourts: []} : JSON.parse(ui[1]),
      ...await getUsers(key.private64, courts, users, auth.id)
    };
  };

  const regenKey = async (auth: Auth) => {
    const key = await keyPair64(KEYTYPE_EC) as Key;

    await doReq({pubKey: key.public64}, "resetkey", auth);
    await SecureStore.setItemAsync("key", JSON.stringify(key));
    return key;
  };

  const setFriendObj = async (t: (r: Record<string,string>) => Record<string,string>) => {
    if (stat.type!=="normal") throw BAD_STATE;

    const friendKeys: Record<string,string> = t({...stat.friendKeys});
    await AsyncStorage.setItem("friendKeys", JSON.stringify(t(friendKeys)));
    setNState((s) => ({...s, friendKeys}));
  };

  const doRefresh = async (auth: Auth, name: string|null, key: Key) => {
    //all users except possibly us have non null usernames
    let newStat: AppStatus = name!==null ?
      await makeNormalState(auth, key, await doReq(null, "refresh", auth))
      : { type: "naming", key };

    setState((x) => ({ ...x, auth, status: newStat }));
  };

  if (req.type=="reset" || req.type=="quit") {
    console.log("quitting!");

    setState((x) => ({
      ...x,
      busy: false,
      loading: false,
      status: {type: "registering"}
    }));
    
    if (req.type=="reset") {
      await AsyncStorage.multiRemove(["id", "email"]);
      await SecureStore.deleteItemAsync("token");
      await stop();

      if (state.status.type==="normal")
        await doReq(null, "update");
    }
  } else if (stat.type=="normal") { switch (req.type) {
    case "add": {
      const res: {info: ServerUserInfo, pubKey: string} =
        await doReq({id: req.id}, "add");

      let newUser = await toUser(stat.key.private64, stat.courts, res.info);
      setNState((x) => ({...x, users: {...x.users, [res.info.id]: newUser}}));

      await setFriendObj((r) => ({...r, [newUser.id]: res.pubKey}));
      if (stat.self.where!==null)
        sendToFriends({[newUser.id]: newUser.pubKey}, state.auth!, stat.self.where, stat.key.private64);

      break;
    }
    case "remove": {
      await setFriendObj((r) => {
        delete r[req.id];
        return r;
      });

      await doReq({id: req.id, both: req.both}, "remove");

      setNState((x) => {
        if (x.users[req.id].status=="both") {
          return {...x, users: {...x.users,
            [req.id]: {...x.users[req.id], status: "other"}}};
        } else {
          let users = {...x.users};
          delete users[req.id];
          return {...x, users};
        }
      });

      break;
    }
    case "search": {
      const res = await doReq({name: req.name}, "search");
      setNState((x) => ({...x, search: {...x.search, result: res}}));

      break;
    }
    case "setname": {
      await doReq({name: req.name}, "setname");
      setNState((x) => ({...x, self: {...x.self, username: req.name}}));

      break;
    }
    case "start": {
      if (!stat.hasBackgroundLocationPermission)
        setState((x) => ({...x, loading: true}));

      try {
        let a = await Location.requestForegroundPermissionsAsync();
        if (a.granted) {
          let b = await Location.requestBackgroundPermissionsAsync();
          if (b.granted) {
            await start(stat.courts, whereCb);
            setState((x) => ({...x, status: {...x.status,
              background: true, hasBackgroundLocationPermission: true}}));
            callback?.();
            return;
          }
        }
      } catch (e) {
        raise("Error requesting location", (e as any).toString());
        return;
      }

      if (callback===undefined || callback({err: "permNotGranted", message: null})) {
        raise("Error", "Location permission not granted");
      }

      break;
    }
    case "stop": {
      await stop();
      setNState((x) => ({...x, background: false, self: {...x.self, where: null}}));

      await doReq(null, "update");

      break;
    }
    case "setUI": {
      //apparently this is slow?
      AsyncStorage.setItem("uiState", JSON.stringify(req.ui));
      setState((x) => ({...x, status: {...x.status, ui: req.ui}}));
      break;
    }
    default: {
      console.log("couldn't handle (normal)", req);
      throw BAD_STATE;
    }
  } } else { switch (req.type) {
    case "load": {
      let id = await AsyncStorage.getItem("id");
      let token = await SecureStore.getItemAsync("token");
      console.log(`found ${id}, ${token}`);
      
      if (id===null || token===null) {
        let email = await AsyncStorage.getItem("email");
        if (email===null) {
          setState((x) => ({...x, busy: false, loading: false,
            status: {type: "registering"}}));
        } else {
          let res = await doReq({email, send: false}, "register");
          //dont mind me and my lovely duplicate code
          setState((x) => ({ ...x,
            status: {type: "verifying", id: res.id, name: res.name, badCode: false}
          }));
        }

        break;
      }

      const auth = {id, token};
      const res: ServerUserInfo[] = await doReq(null, "refresh", auth);

      const name = res.find((x) => x.id===auth.id)?.username ?? null;

      const keyStr = await SecureStore.getItemAsync("key");
      if (keyStr==null) {
        //we have id/token and logged in, so we should have a private key but we lost it? app data wiped? idk
        setState((x) => ({...x, auth,
          status: {type: "needResetKey", name, hasLocalKey: false}}));
        break;
      }

      const key: Key = JSON.parse(keyStr);

      if (name!==null) {
        let normal = await makeNormalState(auth!, key, res);
        setState((x) => ({...x, auth, status: normal}));
      } else {
        setState((x) => ({...x, auth, status: {type: "naming", key}}));
      }

      break;
    }
    case "register": {
      await AsyncStorage.setItem("email", req.email);
      const res: {id: string, name: string|null} = await doReq({email: req.email, send: req.send}, "register");

      setState((x) => ({
        ...x,
        status: {type: "verifying", id: res.id, name: res.name, badCode: false}
      }));

      break;
    }
    case "verify": {
      if (stat.type!="verifying") throw BAD_STATE;

      if (req.url.queryParams===null || typeof req.url.queryParams.code !== "string") {
        setState((x) => ({...x, status: {...x.status, badCode: true}}));
        return;
      }

      const res: {pubKey: string|null, token: string} = await doReq({ id: stat.id, code: req.url.queryParams.code }, "verify");

      await AsyncStorage.setItem("id", stat.id);
      await SecureStore.setItemAsync("token", res.token);

      const auth = {id: stat.id, token: res.token};

      const keyStr = await SecureStore.getItemAsync("key");
      let key: Key|null = keyStr==null ? null : JSON.parse(keyStr);

      if (res.pubKey===null) {
        if (key!==null) {
          setState((x) => ({...x, auth, status: {type: "needResetKey", name: stat.name, hasLocalKey: true}}));
          break;
        }

        key = await regenKey(auth);
      } else if (key==null || key.public64!=res.pubKey) {
        setState((x) => ({...x, auth,
          status: {type: "needResetKey", name: stat.name, hasLocalKey: key!=null}}));
        break;
      }

      await doRefresh(auth, stat.name, key);
      break;
    }
    case "setname": {
      if (stat.type!="naming" || state.auth===undefined) throw BAD_STATE;

      await doReq({name: req.name}, "setname");

      const users = await doReq({}, "refresh");
      const ns = await makeNormalState(state.auth, stat.key, users);
      setState((x) => ({...x, status: ns}))
      break;
    }
    case "resetKey": {
      if (state.auth===undefined || stat.type!=="needResetKey") throw BAD_STATE;
      const key = await regenKey(state.auth);
      await doRefresh(state.auth, stat.name, key);
      break;
    }
    default: {
      console.log("couldn't handle", req);
      throw BAD_STATE;
    }
  } }
  
  if (callback!==undefined) callback();
}

export function dispatchErr(req: AppRequest, state: AppState, setState: SetAppState, callback?: (err?: CallbackError) => boolean) {
  let setStateWS = (cb: (state: AppState) => AppState) => {
    setState((state) => {
      let ns = cb(state);

      if (state.status.type==="normal"
        && (ns.status.type!=="normal" || ns.status.ws!==state.status.ws)) {
        state.status.ws.close();
      }

      if (state.status.type==="normal" && state.status.wsDisconnectRetry!==null
        && (ns.status.type!=="normal" || ns.status.wsDisconnectRetry!==state.status.wsDisconnectRetry)) {
        window.clearTimeout(state.status.wsDisconnectRetry)
      }

      console.log("new state", ns);
      return ns;
    })
  };

  dispatch(req, state, setStateWS, callback).catch((e) => {
    if (e instanceof HandledServerError) return;
    else if (e instanceof Error && e.stack!==undefined) {
      console.error("stack", e.stack);
    }

    console.error("kinda serious error", e);
    state.handleError("Client error", e.toString());
  }).then(() => {
    //literal garbage
    setState((s) => ({...s, busy: false, loading: false}));
  });
}

export const AppContext = React.createContext<{
  state: AppState,
  req: (req: AppRequest, callback?: (err?: CallbackError) => boolean) => void
} | null>(null);

export function useApp() {
  const app = React.useContext(AppContext);
  if (!app) throw "app context uninitialized";
  return app;
}

export function useNormal() {
  const app = useApp();
  if (app.state.status.type!="normal") throw BAD_STATE;
  return {...app, status: app.state.status};
}

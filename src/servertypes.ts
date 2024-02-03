import { encode } from "base-64";

export type DiningFloor = {
  name: string|null,
  eleStart: number|null,
  eleEnd: number|null,
  poly: number[][]
};

export type DiningCourt = {
  name: string,
  color: string,
  floors: DiningFloor[]
};

export type UserWhere = {
  where: string,
  floor: string|null,
  since: Date,
  updated: Date
}

export type UserWhereObj = {
  where: string,
  floor: string|null,
  since: string,
  updated: string
}

type BaseUserInfo = {
  id: string,
  username: string,
  pubKey: string,
  status: "both" | "you" | "other"
};

export type UserInfo = BaseUserInfo & {where: UserWhere|null};
export type ServerUserInfo = BaseUserInfo & {where: string|null};

export type ServerErrorResponse = {
  err: "notFound" | "userNotFound" | "badName" | "badEmail" | "noName" | "badToken" | "expired" | "disconnect" | "nameTaken" | "rateLimit",
  message: string
};

export type Auth = {id: string, token: string};
export type WSServerMessage = { type: "update", info: ServerUserInfo }
  | {type: "add", info: ServerUserInfo }
  | {type: "remove", id: string }
  | {type: "error"} & ServerErrorResponse;

export type Key = {private64: string, public64: string};
  
export const ENV = (process.env as any) as {EXPO_PUBLIC_API_ROOT: string, EXPO_PUBLIC_ROOT: string};
export const API_ROOT = new URL(ENV.EXPO_PUBLIC_API_ROOT);
console.log(API_ROOT.href);
export const WS_URL = new URL("ws", API_ROOT);
export const UPDATE_LIMIT = 5*60*1000;

WS_URL.protocol = API_ROOT.protocol == "https:" ? "wss:" : "ws:";

export class ServerError extends Error {
  constructor(public readonly err: ServerErrorResponse) {
    super(err.message);
  }
}

export function validEmail(email: string) {
  return email.match(/^[a-zA-Z0-9._%+-]+@purdue\.edu$/)!==null;
}

export function validName(name: string) {
  return name.match(/^[a-zA-Z0-9_]{1,12}$/)!==null;
}

export async function send(data: any, path: string, auth?: Auth): Promise<ServerErrorResponse | any> {
  let res: any = null;

  let isGet = path=="refresh" || path=="courts";

  console.log(`sending ${JSON.stringify(data)} to /api/${path} ${isGet ? "(GET)" : "(POST)"}`)

  let hmap = new Headers({"Content-Type": "application/json"});
  if (auth!==undefined) {
    hmap.append("Authorization", `Basic ${encode(`${auth.id}:${auth.token}`)}`);
  }

  let prom=fetch(new URL(path, API_ROOT), {
    method: isGet ? "GET" : "POST",
    headers: hmap,
    body: isGet ? null : JSON.stringify(data),
    credentials: "include"
  });

  let ret = await prom;
  let txt = await ret.text();
  console.log(`received ${txt}`);
  res = JSON.parse(txt);

  if (!ret.ok) {
    let err = res as ServerErrorResponse;
    throw new ServerError(err);
  }

  return res;
};
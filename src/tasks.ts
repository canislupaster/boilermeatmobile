import * as Location from "expo-location";
import * as BackgroundFetch from "expo-background-fetch";
import * as TaskManager from 'expo-task-manager';
import { isTaskRegisteredAsync } from "expo-task-manager";
import { Auth, DiningCourt, Key, UserWhere, UserWhereObj, debug, send } from "./servertypes";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import * as Notifications from "expo-notifications";
import { Feature, LineString, MultiLineString, MultiPolygon, Polygon, booleanPointInPolygon, centroid, distance, lineString, lineStringToPolygon, nearestPointOnLine, pointToLineDistance, polygon, union } from "@turf/turf";
import { secureMessageEncrypt64 } from "react-native-themis";

export const GEOFENCE_TASK = "geofence";
export const BACKGROUND_TASK = "background";
export const ACCURACY=10;
const MIN_UPDATE_DURATION_MS = 15000;

type HallRegion = {
  name: string,
  floor: string|null,
  poly: number[][],
  eleStart: number|null,
  eleEnd: number|null
};

type BoundingCircle = {
  lat: number, lon: number,
  radius: number,
  hallName: string
};

type Data = {
  regions: HallRegion[],
  circles: BoundingCircle[];
};

type WhereHandler = ((where: UserWhere|null) => void);
let handleWhereChange: WhereHandler|null = null;

const cb = (f: () => Promise<void>) => {f().catch(console.error);}

function checkEle(h: HallRegion, coord: Location.LocationObjectCoords) {
  return (h.eleStart==null || coord.altitude! < h.eleStart)
    && (h.eleEnd==null || coord.altitude! > h.eleEnd);
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: true
  }),
  handleError(notificationId, error) {
    console.error("notification error", notificationId, error);
  }
});

async function update(h?: HallRegion) {
  debug("update to", h);
  const id = await AsyncStorage.getItem("id");

  const friendKeys = await AsyncStorage.getItem("friendKeys");
  const [token, lastWhere, key] = await Promise.all(["token", "lastWhere", "key"]
    .map((x) => SecureStore.getItemAsync(x)));
  if (id==null || token==null || key==null) throw "not authenticated";
  
  const auth: Auth = {id, token};

  if (h===undefined) {
    await Notifications.dismissAllNotificationsAsync();

    handleWhereChange?.(null);
    await SecureStore.deleteItemAsync("lastWhere");
    await send(null, "update", auth);
    return;
  }

  let where: UserWhere = {
    where: h.name,
    floor: h.floor,
    since: new Date(),
    updated: new Date()
  };

  let diff=false;
  if (lastWhere) {
    const lastWhereObj: UserWhereObj = JSON.parse(lastWhere);
    if (new Date(lastWhereObj.updated).getTime() + MIN_UPDATE_DURATION_MS > where.updated.getTime()) {
      handleWhereChange?.({
        where: lastWhereObj.where,
        floor: lastWhereObj.floor,
        since: new Date(lastWhereObj.since),
        updated: new Date(lastWhereObj.updated),
      });

      debug("too recent, not updating");
      return;
    }

    if (where.where == lastWhereObj.where) {
      where.since=new Date(lastWhereObj.since);
    } else {
      diff=true;
    }
  }

  if (lastWhere==null || diff) {
    await Notifications.dismissAllNotificationsAsync();

    debug("notifying");
    await Notifications.scheduleNotificationAsync({
      identifier: "whereUpdate",
      content: {
        title: `You're at ${where.where}!`,
        body: "Head into the app to stop securely broadcasting to friends"
      },
      trigger: null
    });
  }

  handleWhereChange?.(where);
  if (friendKeys==null) {
    debug("no friends to send location to, just displaying in app");
    return;
  }

  const friendKeysObj: Record<string,string> = JSON.parse(friendKeys);
  const keyParsed: Key = JSON.parse(key);
  await sendToFriends(friendKeysObj, auth, where, keyParsed.private64);
}

export async function sendToFriends(friendKeys: Record<string, string>, auth: Auth, where: UserWhere, privateKey: string) {
  const newWhere = JSON.stringify(where);
  debug("sending", newWhere);
  await SecureStore.setItemAsync("lastWhere", newWhere);

  const res = (await Promise.allSettled(Object.entries(friendKeys)
    .map(async ([a,friendPubKey]) => {
      return [a, await secureMessageEncrypt64(newWhere, privateKey, friendPubKey)];
    })))
      .map((x) => x.status==="fulfilled" ? x.value : null)
      .filter((x) => x!==null);

  debug(`encoded to ${res.length} of ${Object.keys(friendKeys).length} friends`, res);

  await send(Object.fromEntries(res as string[][]), "update", auth);
}

async function restartGeofencing(data: Data, loc?: Location.LocationObject) {
  let active: string|null = null;

  loc = loc ?? await Location.getCurrentPositionAsync({accuracy: Location.Accuracy.High});
  for (const circ of data.circles) {
    if (distance([loc.coords.longitude, loc.coords.latitude],
      [circ.lon, circ.lat], {units: "meters"})<=circ.radius)
      active = circ.hallName;
  }

  if (active==null) {
    if (await SecureStore.getItemAsync("active")!==null)
      await SecureStore.deleteItemAsync("active");

    await Location.startGeofencingAsync(GEOFENCE_TASK, data.circles.map((x) => ({
      latitude: x.lat, longitude: x.lon, radius: x.radius,
      identifier: x.hallName, notifyOnEnter: true, notifyOnExit: true
    })));
  } else {
    await SecureStore.setItemAsync("active", active);
    await geoFenceActive(data, active, loc);
  }
}

async function geoFenceActive(data: Data, active: string, loc?: Location.LocationObject) {
  loc = loc ?? await Location.getCurrentPositionAsync({accuracy: Location.Accuracy.High});
  const coord = [loc.coords.longitude, loc.coords.latitude];

  let rad=Infinity, updated=false;
  for (let reg of data.regions.filter((x) => x.name==active)) {
    const inside = booleanPointInPolygon(coord, polygon([reg.poly]))

    if (inside && !updated && checkEle(reg, loc.coords)){
      await update(reg);
      updated=true;
    }

    const nearest = pointToLineDistance(coord, lineString(reg.poly), {units: "meters"});
    if (nearest<rad) rad=nearest;
  }

  if (!updated) await update();

  //what the hell!
  if (!isFinite(rad)) {console.error(`no lines in active region ${active}!`); return;}
  debug(`new circle with radius ${rad} from current loc ${coord.join(", ")} about ${active}`);

  rad += 5;
  const circ = data.circles.find((x) => x.hallName==active)!;

  //mutually recursive :clown:
  if (distance([loc.coords.longitude, loc.coords.latitude],
    [circ.lon, circ.lat], {units: "meters"})>circ.radius)
    restartGeofencing(data, loc);

  return Location.startGeofencingAsync(GEOFENCE_TASK, [
    {
      latitude: circ.lat,
      longitude: circ.lon,
      radius: circ.radius,
      identifier: "big",
      notifyOnExit: true,
      notifyOnEnter: false
    }, {
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
      radius: rad,
      identifier: "small",
      notifyOnExit: true,
      notifyOnEnter: false
    }
  ]);
}

TaskManager.defineTask<{eventType: Location.GeofencingEventType, region: Location.LocationRegion}>(GEOFENCE_TASK, ({data: {eventType, region}, error}) => cb(async () => {
  if (error) console.error(error);
  debug("geofence update", eventType, region);

  const data = await AsyncStorage.getItem("halls");
  const dataObj = JSON.parse(data!);

  const active = await SecureStore.getItemAsync("active");

  if (active==null && region.state==Location.GeofencingRegionState.Inside) {
    await SecureStore.setItemAsync("active", region.identifier!);
    await geoFenceActive(dataObj, region.identifier!);
  } else if (active!==null && region.state==Location.GeofencingRegionState.Outside) {
    if (region.identifier==="big") await restartGeofencing(dataObj);
    else await geoFenceActive(dataObj, active);
  }
}));

//occasionally restart geofencing
TaskManager.defineTask(BACKGROUND_TASK, () => cb(async () => {
  const data: Data = JSON.parse((await AsyncStorage.getItem("halls"))!);
  await restartGeofencing(data);
}))

export async function start(halls: DiningCourt[], handler: WhereHandler) {
  handleWhereChange = handler;
  
  let data: Data = {regions: [], circles: []};

  for (let hall of halls) {
    let polys = hall.floors.map((floor) => {
      data.regions.push({
        name: hall.name,
        floor: floor.name,
        poly: floor.poly,
        eleStart: floor.eleStart,
        eleEnd: floor.eleEnd
      });

      return polygon([floor.poly]);
    });

    let poly: Feature<Polygon|MultiPolygon> = polys[0];
    for (let i=1; i<polys.length; i++) poly = union(poly, polys[i])!;
    let cent = centroid(poly);
    let coords = poly.geometry.type=="MultiPolygon"
      ? poly.geometry.coordinates.flat().flat() :  poly.geometry.coordinates.flat();

    let radius = 0;
    for (let coord of coords) {
      let d = distance(cent,coord,{units: "meters"});
      if (d>radius) radius = d;
    }
    
    data.circles.push({
      lat: cent.geometry.coordinates[1],
      lon: cent.geometry.coordinates[0],
      radius, hallName: hall.name
    });

    debug("adding region", data.circles[data.circles.length-1]);
  }
 
  await AsyncStorage.setItem("halls", JSON.stringify(data));

  await BackgroundFetch.registerTaskAsync(BACKGROUND_TASK, {
    minimumInterval: 0
  });

  await restartGeofencing(data);
}

export async function isRunning() {
  return await isTaskRegisteredAsync(GEOFENCE_TASK) || await isTaskRegisteredAsync(BACKGROUND_TASK);
}

export async function stop() {
  debug("stopping");

  await Notifications.dismissAllNotificationsAsync();

  if (await isTaskRegisteredAsync(BACKGROUND_TASK))
    await BackgroundFetch.unregisterTaskAsync(BACKGROUND_TASK).catch(() => {});
  if (await isTaskRegisteredAsync(GEOFENCE_TASK))
    //if permission changes while task is running, this method errors so have to unregister manually, which is also done below
    await Location.stopGeofencingAsync(GEOFENCE_TASK).catch(() => {});

  await TaskManager.unregisterAllTasksAsync().catch(() => {});
  await SecureStore.deleteItemAsync("lastWhere");
}

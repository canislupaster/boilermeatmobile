import * as Location from "expo-location";
import * as BackgroundFetch from "expo-background-fetch";
import * as TaskManager from 'expo-task-manager';
import { isTaskRegisteredAsync } from "expo-task-manager";
import { Auth, DiningCourt, Key, UserWhere, UserWhereObj, send } from "./servertypes";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from 'expo-secure-store';
import { Feature, MultiPolygon, Polygon, booleanPointInPolygon, centroid, distance, polygon, union } from "@turf/turf";
import { secureMessageEncrypt64 } from "react-native-themis";

export const GEOFENCE_TASK = "geofence";
export const LOCATION_TASK = "location";
export const CHECK_ELE_TASK = "location-ele";
export const ACCURACY=10;
const MIN_UPDATE_DURATION_MS = 15000;

type HallRegion = {
  name: string,
  floor: string|null,
  poly: Feature<Polygon>,
  eleStart: number|null,
  eleEnd: number|null
};

//for all our (>=1) special users living in hilly, right above the goddamn dining court
type Active = {
  badEle: string[],
  in: string[]
};

type WhereHandler = ((where: UserWhere|null) => void);
let handleWhereChange: WhereHandler|null = null;
let isStopping: boolean = false;

const locationTaskOptions: Location.LocationTaskOptions = {
  accuracy: Location.Accuracy.Balanced,
  pausesUpdatesAutomatically: true,
  // deferredUpdatesInterval: 1000*60,
  showsBackgroundLocationIndicator: false,
  foregroundService: {
    notificationTitle: "Boilermeat is checking your location",
    notificationBody: "You're in the vicinity of a dining court",
    notificationColor: "#610d20"
  }
};

function checkEle(h: HallRegion, coord: Location.LocationObjectCoords) {
  return (h.eleStart==null || coord.altitude! < h.eleStart)
    && (h.eleEnd==null || coord.altitude! > h.eleEnd);
}

async function update(h?: HallRegion) {
  const id = await AsyncStorage.getItem("id");

  const friendKeys = await AsyncStorage.getItem("friendKeys");
  const [token, lastWhere, key] = await Promise.all(["token", "lastWhere", "key"]
    .map((x) => SecureStore.getItemAsync(x)));
  if (id==null || token==null || key==null) throw "not authenticated";
  
  const auth: Auth = {id, token};

  if (h===undefined) {
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

  if (lastWhere) {
    const lastWhereObj: UserWhereObj = JSON.parse(lastWhere);
    if (new Date(lastWhereObj.updated).getTime() + MIN_UPDATE_DURATION_MS > where.updated.getTime()) {
      handleWhereChange?.({
        where: lastWhereObj.where,
        floor: lastWhereObj.floor,
        since: new Date(lastWhereObj.since),
        updated: new Date(lastWhereObj.updated),
      });

      console.log("too recent, not updating");
      return;
    }

    if (where.where == lastWhereObj.where) where.since=new Date(lastWhereObj.since);
  }

  handleWhereChange?.(where);
  if (friendKeys==null) {
    console.log("no friends to send location to, just displaying in app");
    return;
  }

  const friendKeysObj: Record<string,string> = JSON.parse(friendKeys);
  const keyParsed: Key = JSON.parse(key);
  await sendToFriends(friendKeysObj, auth, where, keyParsed.private64);
}

export async function sendToFriends(friendKeys: Record<string, string>, auth: Auth, where: UserWhere, privateKey: string) {
  const newWhere = JSON.stringify(where);
  console.log("sending", newWhere);
  await SecureStore.setItemAsync("lastWhere", newWhere);

  const res = (await Promise.allSettled(Object.entries(friendKeys)
    .map(async ([a,friendPubKey]) => {
      return [a, await secureMessageEncrypt64(newWhere, privateKey, friendPubKey)];
    })))
      .map((x) => x.status==="fulfilled" ? x.value : null)
      .filter((x) => x!==null);

  console.log(`encoded to ${res.length} of ${Object.keys(friendKeys).length} friends`, res);

  await send(Object.fromEntries(res as string[][]), "update", auth);
}

TaskManager.defineTask<{locations: Location.LocationObject[]}>(LOCATION_TASK, async ({ data, error }) => {
  if (error) console.error(error);
  console.log("location update", data);

  if (data!==null) {
    let mostRecent: Location.LocationObject|null = null;
    for (let loc of data.locations) {
      if (loc.coords.altitude!==null
        && (mostRecent==null || loc.timestamp>mostRecent.timestamp))
        mostRecent = loc;
    }
    
    if (mostRecent!==null) {
      let active: Active = JSON.parse((await AsyncStorage.getItem("active"))!);
      let halls: HallRegion[] = JSON.parse((await AsyncStorage.getItem("halls"))!);

      await upAct(active, mostRecent);
      
      for (let h of halls) {
        if (!active.in.includes(h.name)) continue;

        console.log("checking", h.name);
        if (booleanPointInPolygon([mostRecent.coords.longitude, mostRecent.coords.latitude], h.poly)) {
          if (!isStopping)
            await Location.startLocationUpdatesAsync(LOCATION_TASK, {
              ...locationTaskOptions,
              foregroundService: {
                notificationTitle: `Inside ${h.name}${h.floor==null ? "" : ` (${h.floor})`}`,
                notificationBody: "Open the app to stop sharing the news with your friends.",
                notificationColor: "#1cb05f"
              }
            });

          update(h).catch(console.error);
          return;
        }
      }
    }
  }

  update().catch(console.error);;
});

async function upAct(active: Active, inLoc?: Location.LocationObject) {
  console.log("upact", isStopping, await TaskManager.getRegisteredTasksAsync());
  //to ensure all tasks are actually stopped when stop() is called we should make sure tasks cant start each other up again
  if (isStopping) return;

  let halls: HallRegion[] = JSON.parse((await AsyncStorage.getItem("halls"))!);
  const loc = inLoc ?? await Location.getCurrentPositionAsync({accuracy: Location.Accuracy.High});

  let newActive: Active = {in: [], badEle: []};
  for (let name of [...active.badEle, ...active.in]) {
    if (halls.find((x) => x.name==name && checkEle(x, loc.coords))==undefined) {
      newActive.badEle.push(name);
    } else {
      newActive.in.push(name);
    }
  }

  console.log("new active", newActive);
  await AsyncStorage.setItem("active", JSON.stringify(newActive));

  if (newActive.in.length > 0) {
    await Location.startLocationUpdatesAsync(LOCATION_TASK, locationTaskOptions);

    if (await TaskManager.isTaskRegisteredAsync(CHECK_ELE_TASK))
      await BackgroundFetch.unregisterTaskAsync(CHECK_ELE_TASK);
  } else {
    if (newActive.badEle.length>0) {
      await BackgroundFetch.registerTaskAsync(CHECK_ELE_TASK, { minimumInterval: 30 });
    } else if (await TaskManager.isTaskRegisteredAsync(CHECK_ELE_TASK)) {
      await BackgroundFetch.unregisterTaskAsync(CHECK_ELE_TASK);
    }
    
    if (await isTaskRegisteredAsync(LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    }

    update().catch(console.error);
  }
}

TaskManager.defineTask(CHECK_ELE_TASK, async () => {
  let active: Active = JSON.parse((await AsyncStorage.getItem("active"))!);
  console.log("checking elevation");
  await upAct(active);
});

TaskManager.defineTask<{eventType: Location.GeofencingEventType, region: Location.LocationRegion}>(GEOFENCE_TASK, async ({data: {eventType, region}, error}) => {
  if (error) console.error(error);
  console.log("geofence update", eventType, region);

  let active: Active = JSON.parse((await AsyncStorage.getItem("active"))!);
  let f = (x: string[]) => x.filter((hall: string) => hall!==region.identifier);
  active.in = f(active.in); active.badEle = f(active.badEle);

  if (region.state==Location.GeofencingRegionState.Inside)
    active.badEle.push(region.identifier!);
  
  await upAct(active);
});

export async function start(halls: DiningCourt[], handler: WhereHandler) {
  console.log("starting geofencing");
  handleWhereChange = handler;
  
  let active: Active = {in: [], badEle: []};
  const loc = await Location.getCurrentPositionAsync({accuracy: Location.Accuracy.High});
  
  let hallRegions: HallRegion[] = [];
  let geoRegions = halls.map((hall): Location.LocationRegion => {
    let polys = hall.floors.map((floor) => {
      let poly = polygon([floor.poly]);

      hallRegions.push({
        name: hall.name,
        floor: floor.name,
        poly,
        eleStart: floor.eleStart,
        eleEnd: floor.eleEnd
      });

      return poly;
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
    
    console.log("adding region", hall.name, cent.geometry.coordinates, radius)
    
    if (distance([loc.coords.longitude, loc.coords.latitude], cent.geometry.coordinates, {units: "meters"}) < radius) {
      active.badEle.push(hall.name);
    }
    
    return {
      latitude: cent.geometry.coordinates[1],
      longitude: cent.geometry.coordinates[0],
      radius,
      identifier: hall.name,
      notifyOnEnter: true,
      notifyOnExit: true
    };
  });
 
  isStopping=false;
  await AsyncStorage.setItem("halls", JSON.stringify(hallRegions));
  await upAct(active, loc);

  await Location.startGeofencingAsync(GEOFENCE_TASK, geoRegions);
}

export async function isRunning() {
  return await isTaskRegisteredAsync(GEOFENCE_TASK);
}

export async function stop() {
  console.log("stopping");
  isStopping=true;
  if (await isTaskRegisteredAsync(GEOFENCE_TASK))
    //if permission changes while task is running, this method errors so have to unregister manually, which is also done below
    await Location.stopGeofencingAsync(GEOFENCE_TASK).catch(() => {});
  if (await isTaskRegisteredAsync(CHECK_ELE_TASK))
    await BackgroundFetch.unregisterTaskAsync(CHECK_ELE_TASK);
  if (await isTaskRegisteredAsync(LOCATION_TASK))
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  await TaskManager.unregisterAllTasksAsync().catch(() => {});
  await SecureStore.deleteItemAsync("lastWhere");
}

import React, { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Page, useApp, useNormal } from "./server";
import { Box, Button, Card, Form, IconButton, LabeledTextInput, ModalOutside, Tabs, Text, Modal, BackButton, ChoiceModal, ErrorCard, userColors, Icon, sinceColorBreakpoints, sinceColors, Pressable, Link } from "./theme";
import { EvilIcons, FontAwesome6, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Linking from 'expo-linking';
import { FlatList, ScrollView, View  } from "react-native";
import { ChangeName  } from "./register";
import { UserInfo, DiningCourt, DiningFloor, validName, ENV } from "./servertypes";
import * as Location from 'expo-location';
import PagerView from "react-native-pager-view";

type UserColor = [string, "background" | "text"];
let userColorMap: Map<string, UserColor> = new Map();

function sinceTime(date: Date): [string, string] {
  const [txt, setTxt] = useState<[string, string]>(["", ""]);

  useEffect(() => {
    let timeout:null|NodeJS.Timeout=null;

    let cb = () => {
      let ot = date.getTime();
      let d = Math.ceil((Date.now()-ot)/1000);
      let a = ["s","m","h"], m=1000; //smh
      let res: [string, number]|null = null;
      
      let hr = date.getHours();
      let min = date.getMinutes().toString();
      if (hr>12) hr-=12;
      else if (hr==0) hr=12;
      if (min.length<2) min=`0${min}`;
      
      let sti=0;
      while (sti<sinceColorBreakpoints.length && d>sinceColorBreakpoints[sti]) sti++;

      for (let i=0; i<3; i++) {
        if (d<60 || i==2) {
          res = [
            `${hr}:${min} (${d} ${a[i]})`,
            m - ot%m
          ];

          break;
        }

        d=Math.floor(d/60);
        m*=60;
      }
      
      if (res===null) throw "unreachable";

      setTxt([res[0], sinceColors[sti]]);
      timeout = setTimeout(cb, res[1]);
    };
    
    cb();

    return () => {
      if (timeout!==null) clearTimeout(timeout);
    };
  }, [date])
  
  return txt;
}

function SinceTime({date}: {date: Date}) {
  const [txt, col] = sinceTime(date);
  return <Box paddingHorizontal="xs" 
      style={{backgroundColor:col}} >
    <Text fontWeight="bold" fontStyle="italic" >{txt}</Text>
  </Box>;
}

function userColor(name: string): UserColor {
  if (userColorMap.has(name)) return userColorMap.get(name)!;

  let x=0;
  for (let i=0; i<name.length; i++) x=(5*x+name.charCodeAt(i))%userColors.length;
  let col: UserColor = [userColors[x][0], userColors[x][1] ? "background" : "text"];
  userColorMap.set(name, col);

  return col;
}

function SinceTimeTag({date}: {date: Date}) {
  const [txt, col] = sinceTime(date);
  return <Box borderTopRightRadius="l" borderBottomRightRadius="l" 
    style={{backgroundColor:col}} marginLeft="s" padding="xs" flexDirection="column"
    justifyContent="center" >
      <Text variant="med" fontSize={17} >{txt}</Text>
    </Box>;
}

function UserTag({username, id, where, onPress}: UserInfo & {onPress?: () => void}) {
  let [color, txt] = userColor(username);
  return <Button borderWidth={0} style={{backgroundColor: color}}
    borderRadius="l" noWrapper margin="s"
    marginTop="s" paddingVertical="none" paddingLeft="s"
    paddingRight={where===null ? "s" : "none"}
    flexDirection="row" alignItems="stretch"
    onPress={onPress}>
    <Box alignSelf="center" >
      <Text color={txt} variant="fat" fontSize={18} >{username}</Text>
    </Box>
    {where!==null ? <SinceTimeTag date={where.since} /> : <></>}
  </Button>;
}

function filterUser(users: UserInfo[], filter: "where" | "floor") {
  return useMemo(() => {
    let obj: Map<string, UserInfo[]> = new Map();
    for (const user of users) {
      if (user.where===null) continue;
      let f = user.where[filter] ?? "";
      let x = obj.get(f);
      if (x) x.push(user);
      else obj.set(f, [user]);
    }

    return obj;
  }, [users]);
}

type SelectUser = { selectUser: (id: string) => void };

export function DiningCourtView({court, usersInCourt, collapsed, toggle, selectUser}:
  {court: DiningCourt, usersInCourt: UserInfo[], collapsed: boolean,
    toggle: () => void} & SelectUser) {
  const floorUsers = filterUser(usersInCourt, "floor");

  return <Card title={
    <Box flex={1} flexDirection="row" justifyContent="space-between" >
      <Text variant="big" >{court.name}</Text>
      <Text variant="big" marginRight="s" >{usersInCourt.length}</Text>
    </Box>
  } headerProps={{
    padding: "m", style: {backgroundColor: court.color}
  }} iconFirst icon={
    <Icon name={collapsed ? "arrow-up" : "arrow-down"}
      marginRight="m" icon={Ionicons} />
  } headerPress={toggle} collapsed={collapsed} >
    {usersInCourt.length==0 ? 
      <Text>You don't know anyone here 😭</Text> 
      : court.floors.map((floor) => {
      let users = floorUsers.get(floor.name ?? "");
      if (!users) return <Fragment key={floor.name} ></Fragment>;
      return <Fragment key={floor.name} >
        {floor.name==null ? <></> : <Text variant="med" >{floor.name}</Text>}

        <Box flexDirection="row" flexWrap="wrap" >
          {users.map((user) => (
            <UserTag key={user.username} {...user} onPress={() => selectUser(user.id)} />
          ))}
        </Box>
      </Fragment>;
    })}
  </Card>;
}

//ew duplicate code 😄
function UserCard({user: {username, id, where, status},
  isSelf, isAdd, onPress}:
  {user: UserInfo, isSelf?: boolean, isAdd?: boolean, onPress?: () => void}) {
  const col = userColor(username);
  
  let iconProps = status==="you" ? null :
    (where!==null ? {name: "radio", icon: Ionicons} : {name: "sleep", icon: MaterialCommunityIcons});

  if (isAdd) {
    iconProps = {name: "square-plus", icon: FontAwesome6};
  }
  
  let stats: [string, React.ReactNode][] = [];
  if (where!==null) {
    stats.push(["where", <Text fontWeight="bold" >at {where.where}</Text>]);
    if (where.floor!==null) stats.push(["floor", <Text fontWeight="bold" >{where.floor}</Text>]);
    stats.push(["since", <SinceTime date={where.since} />]);
  }
    
  let icon: React.ReactNode = <></>;
  if (!isSelf && !isAdd) {
    if (status=="both" || status=="you")
      icon = <Icon name="link" iconProps={{size: 20}} icon={FontAwesome6} />;
    else icon = <Icon name="link-slash" iconProps={{size: 20}} icon={FontAwesome6} />;
  }

  return <Pressable marginVertical="s" paddingRight="s"
      backgroundColor="cardPrimaryBackground" flexDirection="row" justifyContent="space-between"
      onPress={onPress} >
    <Box flex={1} flexDirection="column" >
      <Box flexDirection="row" alignItems="flex-start" justifyContent="space-between" >
        <Box style={{backgroundColor: col[0]}} padding="s" flexDirection="row" alignItems="center" paddingHorizontal="m" >
          <Text variant="big" color={col[1]} >{username}</Text>
        </Box>
        <Box paddingRight="xs" flexDirection="row" alignItems="center" justifyContent="flex-end" >
          {iconProps!==null ? <Icon {...iconProps} /> : <></>}

          {icon}
        </Box>
      </Box>

      {where !== null ? <Box padding="s" flexDirection="row" alignItems="center" flexWrap="wrap" flexShrink={1} >
        {stats.map(([k,x],i) => (<Fragment key={k} >
          {i!=0 ? <Text color="disabled" marginHorizontal="xs" >◆</Text> : <></>}
          <Fragment key={k} >{x}</Fragment>
        </Fragment>))}
      </Box> : <></>}
    </Box>
  </Pressable>
}

function DiningCourts({usersArray, selectUser}: {usersArray: UserInfo[]} & SelectUser) {
  const {status: stat, ...app} = useNormal();

  const courtUsers = filterUser(usersArray, "where");
  const courtsSorted = useMemo(() =>
    [...stat.courts].sort((a,b) => (courtUsers.get(b.name)?.length ?? 0)
      - (courtUsers.get(a.name)?.length ?? 0)), [stat.courts, courtUsers]);
  
  return <FlatList
    ListHeaderComponent={<UserCard user={stat.self} isSelf
      onPress={() => selectUser(stat.self.id)} />}
    renderItem={
      ({item}) => <DiningCourtView court={item}
        //blegh, horror
        collapsed={stat.ui.collapsedCourts.includes(item.name)}
        toggle={() => app.req({
          type: "setUI",
          ui: {...stat.ui,
            collapsedCourts: stat.ui.collapsedCourts.includes(item.name)
              ? stat.ui.collapsedCourts.filter((x) => x!=item.name)
              : [...stat.ui.collapsedCourts, item.name]
          }
        })}
        selectUser={selectUser}
        usersInCourt={courtUsers.get(item.name) ?? []} />
    }
    keyExtractor={(item) => item.name}
    data={courtsSorted}
    extraData={stat.users}
  />;
}

function UserView({userArray, startSearch, selectUser}:
  {userArray: UserInfo[], startSearch: () => void, selectUser: (id: string) => void}) {
  const {status: stat, ...app} = useNormal();

  return <FlatList
    ListHeaderComponent={<UserCard user={stat.self} isSelf
      onPress={() => selectUser(stat.self.id)} />}
    renderItem={
      ({item}) => <UserCard user={item} onPress={() => selectUser(item.id)} />
    }
    ListFooterComponent={<>
      {userArray.length==0 ?
        <Text variant="med" marginVertical="l" >
          Imagine being as friendless as you...
        </Text> : <></>}
      <Button onPress={startSearch} >
        Meat {userArray.length==0 ? "someone new" : "someone else"}
      </Button>
    </>}
    keyExtractor={(item) => item.id}
    data={userArray}
  />;
}

type ActiveModal = {type: "none"} | { type: "changeName" }
  | { type: "grant" } | { type: "search", submitted: boolean, bad: boolean }
  | { type: "user", id: string };

function Home({setActive}: {setActive: (act: ActiveModal) => void}) {
  const [logoutModalShown, setLogoutModal] = useState<boolean>(false);
  const [userShown, setUserShown] = useState<boolean>(false);
  const {status: stat, ...app} = useNormal();

  let [isSocketError, setSocketError] = useState(false);
  useEffect(() => {
    if (stat.wsDisconnectRetry!==undefined) {
      setSocketError(true);
      return () => {};
    } else {
      const timeout = setTimeout(() => {
        setSocketError(false);
      }, 1200);

      return () => clearTimeout(timeout);
    }
  }, [stat.wsDisconnectRetry]);

  const usersArray = useMemo(() =>
    Object.entries(stat.users)
      .filter(([a,b]) => a!=stat.self.id)
      .map(([a,b]) => b), [stat.users]);
      
  const pagerViewRef = useRef<PagerView|null>(null);

  return <>
    {logoutModalShown ? <ModalOutside visible={logoutModalShown} animationType="fade" close={() => setLogoutModal(false)} container transparency={0.3} >
      <ChoiceModal name="You sure about this?" message="Are you sure you want to logout?" action="Logout" choose={(act) => {
        if (act) app.req({type: "reset"}); else setLogoutModal(false);
      }} />
    </ModalOutside> : <></>}

    <Box flex={1} paddingHorizontal="l" >
      {isSocketError ? <Box paddingTop="m" >
        <ErrorCard name="Connection lost" message="Attempting to reconnect..." />
      </Box>
        : <></>}
      
      <PagerView ref={pagerViewRef} initialPage={stat.ui.page=="Courts" ? 0 : 1}
        onPageSelected={(e) => 
          app.req({type: "setUI", ui: {...stat.ui, page: e.nativeEvent.position==0 ? "Courts" : "Users"}})
        }
        orientation="horizontal" style={{flex: 1}} >
        <View key="1" >
          <DiningCourts usersArray={usersArray}
            selectUser={(id) => setActive({ type: "user", id })} />
        </View>
        <View key="2" >
          <UserView userArray={usersArray}
            selectUser={(id) => setActive({ type: "user", id })}
            startSearch={() => setActive({
              type: "search", submitted: false, bad: false
            })} />
        </View>
      </PagerView>
    </Box>
    <Box backgroundColor="background" flexDirection="row" justifyContent="space-between" alignItems="stretch" >
      <Tabs tabs={["Courts", "Users"]} selected={stat.ui.page} onSelect={(newTab) => {
        pagerViewRef.current?.setPage(newTab=="Courts" ? 0 : 1);
      }} />
      
      <Box flex={1} >
        <Button marginTop="none" marginHorizontal="s" borderRadius="none" flex={1} onPress={() => {
          if (stat.background) {
            app.req({type: "stop"});
          } else if (!stat.hasBackgroundLocationPermission) {
            setActive({type: "grant"});
          } else {
            app.req({type: "start"})
          }
        }} disabled={app.state.busy}
          backgroundColor={stat.background ? "blood" : "success"} >
          {stat.background ? "Stop" : "Start"}
        </Button>
      </Box>
      
      <IconButton backgroundColor="background" borderTopColor="highlight" borderTopWidth={2} onPress={() => setUserShown(true)} icon={FontAwesome6} name="user-large" padding="s" />

      <ModalOutside visible={userShown} animationType="slide" close={() => setUserShown(false)} >
        <Card position="absolute" title={<UserTag {...stat.self} />} bottom={0} right={0} borderColor="highlight" icon={<IconButton name="close" onPress={() => setUserShown(false)} icon={EvilIcons} />}>
          <Pressable onPress={() => {
            setActive({type: "changeName"});
            setUserShown(false);
          }} >
            <Text variant="med" >Change name</Text>
          </Pressable>
          <Box height={1} marginVertical="s" alignSelf="stretch" backgroundColor="highlight" />
          <Pressable onPress={() => {
            setLogoutModal(true);
            setUserShown(false);
          }}>
            <Text variant="med" >Logout</Text>
          </Pressable>
        </Card>
      </ModalOutside>
    </Box>
  </>;
}

export function Main() {
  const {status: stat, ...app} = useNormal();

  const [active, setActive] = useState<ActiveModal>({type: "none"});
  
  let exit = () => setActive({type: "none"});

  let backScrollModal = (body: React.ReactNode, title?: React.ReactNode) =>
    <Modal visible onRequestClose={exit} transparent >
      <ScrollView><Box paddingHorizontal="l" marginVertical="xl" >
        <BackButton onPress={exit} marginBottom="l" /> 
        {title!==undefined ? 
          <Text variant="header" marginBottom="l" >{title}</Text>
          : <></>}
        {body}
      </Box></ScrollView>
    </Modal>;

  if (active.type=="user") {
    if (!Object.hasOwn(stat.users, active.id) && active.id != stat.self.id) {
      console.log("user removed during selection");
      exit(); return;
    }

    let u = active.id == stat.self.id ? stat.self : stat.users[active.id];
    let info: string;
    if (active.id==stat.self.id) info="That's you!"
    else switch (u.status) {
      case "both": info = "You're both sharing your location with each other."; break;
      case "you": info = `You're sharing your location with ${u.username}, but they aren't sharing theirs back.`; break;
      case "other": info = `${u.username} is sharing their location with you — consider sharing yours`; break;
    }

    return backScrollModal(<>
      <UserCard user={u} />

      <Box marginVertical="m" />
      
      <Text>{info}</Text>

      <Box marginVertical="m" />

      {u.status=="other" ?
        <Button onPress={() => {
          app.req({type: "add", id: active.id});
        }} >
          <Text variant="fat" >Share your location with {u.username}</Text>
        </Button> : <></>}

      {active.id!=stat.self.id ? <Button onPress={() => {
        app.req({type: "remove", id: active.id, both: u.status=="other"});
      }} borderColor="disabled" backgroundColor="blood" >
        {u.status=="other" ? "Remove" : "Stop sharing"}
      </Button> : <></>}

      <Card title="Public key" borderColor="disabled" >
        <Text fontFamily="monospace" >{
          active.id==stat.self.id ? stat.key.public64
            : (stat.friendKeys[active.id] ?? u.pubKey)
        }</Text>
      </Card>
    </>);
  } else if (active.type=="changeName") {
    return backScrollModal(<ChangeName oldName={stat.self.username} done={exit} />);
  } else if (active.type=="grant") {
    return backScrollModal(
      <>
        <Text variant="med" >
          In bullets:
        </Text>
        {[
          "The only stuff sent/stored on the server is which court/floor and how long you've been there (no raw coordinates)",
          "All of this location information is end-to-end encrypted with ECC (and your friends can't change their keys without you having to re-add them)",
          "The above information is only sent to those you've chosen to in the app (look for the link icon in the users tab)",
          "You can continue securely using the app without location services if you only want to know where your friends are."
        ].map((x,i) => <Box key={i} marginTop="s" >
          <Text>
            <Icon flex={1} name="star" icon={Ionicons} iconProps={{size:20}} marginRight="s" style={{transform: [{translateY: 7}]}} />
            {x}
          </Text>
        </Box>)}
        <Box marginVertical="s" />
        <Text>For more on how your location is used, see the{" "}
          <Link onPress={() => Linking.openURL(new URL("/privacy", ENV.EXPO_PUBLIC_ROOT).href)} >
            privacy policy
          </Link>.
        </Text>
        <Button onPress={() => {
          app.req({type: "start"});
          exit();
        }} >Fair enough</Button>
      </>, "What's the beef with location privacy?");
  } else if (active.type=="search") {
    return backScrollModal(
      <>
        <Form onSubmit={(data) => {
          if (!validName(data.name) || data.name==stat.self.username) {
            setActive({type: "search", submitted: true, bad: true});
          } else {
            app.req({type: "search", name: data.name}, (err) => {
              setActive({type: "search", submitted: true, bad: false});
              return true;
            });
          }
        }} >
          <Text>Just 1 question: who?</Text>
          <LabeledTextInput label="Name" name="name" />
          <Button>Conduct an inquiry</Button>
        </Form>

        <Box marginVertical="m" />
        {active.submitted ? (active.bad || stat.search.result===undefined
          ? <ErrorCard name="He's only imaginary" message={`Couldn't find this "friend" of yours. Isn't that suspicious?`} />
          : <>
            <UserCard user={{
              username: stat.search.result.username, id: stat.search.result.id,
              where:null, pubKey: "", status: "both"
            }} isAdd onPress={() => {
              app.req({type: "add", id: stat.search.result!.id});
              exit();
            }} ></UserCard>
          </>) : <></>}
      </>, "Broil another buddy");
  }

  return <Home setActive={setActive} />;
}
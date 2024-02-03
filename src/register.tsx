import { useEffect, useState } from 'react';
import {theme, Box, Text, ImageBackground, Image, TextInput, LabeledTextInput, Button, Card, IconButton, Form, ErrorCard, BackButton} from './theme';
import { EvilIcons, Ionicons } from '@expo/vector-icons';
import { BAD_STATE, useApp } from './server';
import { validEmail, validName } from './servertypes';

function MeatContainer({children, back}: {children: React.ReactNode, back?: boolean}) {
  const app = useApp();
  return <>
    <Box marginTop="l" style={{ width: "auto" }} paddingHorizontal="l" flexDirection="row" alignItems="center" flex={1} >
      {back===false ? <></> : <BackButton onPress={() => app.req({type: "reset"})} />}
      <Image flex={1} resizeMode="contain" source={require("../assets/meat.png")} />
      <Image flex={4} resizeMode="contain" marginLeft="m" source={require("../assets/bannertext.png")} />
    </Box>

    <Box paddingHorizontal="l" flex={7} justifyContent="center" >
      {children}
    </Box>
  </>;
}

export function Verify() {
  const app = useApp();
  if (app.state.status.type!=="verifying") throw BAD_STATE;
  
  return <MeatContainer>
    <Text variant="header" >
      {app.state.status.name ? `Welcome back, ${app.state.status.name}` : "Almost there 🍖"}
    </Text>
    <Text>Check your email for a verification link.</Text>
    <Text>...if you don't see it, yada yada yada</Text>
    
    <Box marginVertical="m" />

    {app.state.status.badCode ? <ErrorCard name="Invalid verification code"
      message="Try again?" /> : <></>}
  </MeatContainer>;
}

export function Register() {
  let app = useApp();
  let [emailError, setEmailError] = useState<"invalid" | "ratelimit" | null>(null);

  return <MeatContainer back={false} >
    <Text variant="header">Let's beef things up</Text>
    <Form onSubmit={(data) => {
      if (!validEmail(data.email as string)) {
        setEmailError("invalid");
      } else {
        setEmailError(null);
        app.req({type: "register",
          email: (data.email as string).replaceAll(" ", ""),send: true}, (err) => {
          if (err?.err==="rateLimit") {setEmailError("ratelimit"); return false;}
          else return true;
        });
      }
    }} >
      <LabeledTextInput label="Purdue student email" name="email" ></LabeledTextInput>
      <Button>Carry on</Button>
    </Form>
    
    <Box marginVertical="m" />

    {emailError!==null ?
      <ErrorCard name={emailError=="invalid" ? "Invalid email" : "That's too much!"}
        message={emailError=="invalid" ? "Use your @purdue.edu email address"
          : "More than 5 emails sent in the last hour! Spam makes my VPS provider sad :("} />
      : <></>}
  </MeatContainer>
}

export function KeyResetPrompt() {
  let app = useApp();
  if (app.state.status.type!=="needResetKey") throw BAD_STATE;

  return <MeatContainer>
    <Text variant="header">Oh dear. What have you done?</Text>

    <Text variant="med" marginVertical="m" >Maybe you switched accounts, devices, or wiped app data. In any case, {app.state.status.hasLocalKey ? "you have a key on your device that does not match the one on the server." : "we found a key associated with your account on the server."} To be able to update your status, you need to reset the key on your device and server, but this will end all incoming updates until each of your friends adds you back again.</Text>

    <Button onPress={() => app.req({type: "resetKey"})} >Regenerate key</Button>
  </MeatContainer>;
}

export function ChangeName({done, oldName}: {done?: () => void, oldName?: string}) {
  let app = useApp();
  let [err, setErr] = useState<"none" | "taken" | "invalid">("none");
  let [name, setName] = useState(oldName ?? "");

  return <>
    <Text variant="header">Get a handle on yourself!</Text>
    <Form onSubmit={(data) => {
      if (!validName(name as string)) {
        setErr("invalid");
      } else {
        app.req({type: "setname", name}, (err) => {
          if (err!==undefined && err.err=="nameTaken") {
            setErr("taken");
            return false;
          } else {
            done?.();
          }

          return true;
        });
      }
    }} >
      <Text>Names must be between 1-12 characters (letters, numbers, and underscore)</Text>
      <LabeledTextInput label={oldName===undefined ? "Name" : "New name"} name="name"
        value={name} onChangeText={setName} />
      <Button disabled={oldName==name} >Wrap it up</Button>
    </Form>

    <Box marginVertical="m" />
    
    {err=="invalid" ? <ErrorCard name="Invalid name"
      message="Did you forget to read the instructions?" /> : <></>}

    {err=="taken" ? <ErrorCard name="That one's taken!"
      message="Consider being creative, for once...?" /> : <></>}
  </>;
}

export function Naming() {
  return <MeatContainer>
    <ChangeName/>
  </MeatContainer>
}
import Expo, { registerRootComponent } from 'expo';
import * as SplashScreen from 'expo-splash-screen';
import * as Linking from 'expo-linking';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import {ThemeProvider} from '@shopify/restyle';
import {theme, Box, Text, ImageBackground, Image, TextInput, LabeledTextInput, Button, Card, IconButton, Modal, ErrorModal, ModalOutside, ChoiceModal} from './theme';
import { useFonts } from 'expo-font';
import { AppContext, AppRequest, AppState, SetAppState, dispatchErr } from './server';
import { KeyResetPrompt, Naming, Register, Verify } from './register';
import { Main } from './main';
import { EvilIcons } from '@expo/vector-icons';

const fonts = {
  "Montserrat": require("../assets/fonts/Montserrat-Black.ttf"),
  "Montserrat-Med": require("../assets/fonts/Montserrat-SemiBold.ttf"),
  "Merriweather": require("../assets/fonts/Merriweather-Regular.ttf"),
};

export default function App() {
  const [modal, setModal] = useState<React.ReactNode | null>(null);

  const defaultState: AppState = {
    loading: true,
    busy: false,
    handleError: (name, message, retry=false) => new Promise((resolve, reject) => {
      if (retry)
        setModal(<ChoiceModal choose={(act) => {
          setModal(null);
          resolve({retry: act});
        }} action="Try again"
          name={name} message={message}></ChoiceModal>)
      else setModal(<ErrorModal closeModal={() => {
        setModal(null);
        resolve({retry: false});
      }}
        name={name} message={message}></ErrorModal>)
    }),
    status: {type: "registering"}
  };

  const [state, setState] = useState<AppState>(defaultState);

  useEffect(() => {
    dispatchErr({type: "load"}, defaultState, setState);

    return () => setState((s) => {
      dispatchErr({type: "quit"}, s, setState);
      return s;
    });
  }, []);

  const url = Linking.useURL();

  useEffect(() => {
    if (state.status.type!=="verifying" || state.busy) return;

    if (url===null) return;

    const parsed = Linking.parse(url);
    console.log("deep link opened", url, parsed);

    if (parsed.path==="verify") {
      dispatchErr({type: "verify", url: parsed}, state, setState);
    }
  }, [url, state.status.type==="verifying", state.busy]);

  const [fontsLoaded, fontError] = useFonts(fonts);

  const onLayoutRootView = useCallback(async () => {
    if (fontsLoaded || fontError) {
      await SplashScreen.hideAsync();
      if (fontError) state.handleError("Problem loading fonts", fontError.message);
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;
  
  return (<SafeAreaView>
    <StatusBar style="auto" backgroundColor={theme.colors.blood} />
    <ThemeProvider theme={theme}>
      <AppContext.Provider value={{state, req: (x,cb) => dispatchErr(x, state, setState,cb)}}>
        <Modal visible={state.loading} animationType="fade" >
          <Box style={{position: "absolute", left: 0, top: 0, right: 0, bottom: 0}} backgroundColor="mainBackground" flexDirection="column" justifyContent="center" alignItems="center" >
            <ActivityIndicator size="large" color={theme.colors.blood} />
          </Box>
        </Modal>

        <ModalOutside visible={modal!==null} animationType="fade"
          close={() => setModal(null)} transparency={0.2} container zind={100} >
          {modal}
        </ModalOutside>

        <Box
          onLayout={onLayoutRootView}
          backgroundColor="mainBackground"
          flexDirection="column"
          justifyContent="flex-start"
          alignItems="stretch"
          height="100%"
        >
        {(() => {
          switch (state.status.type) {
            case "registering":
              return <Register />;
            case "verifying":
              return <Verify />;
            case "naming":
              return <Naming />;
            case "needResetKey":
              return <KeyResetPrompt />;
            case "normal":
              return <Main />;
          }
        })()}
        </Box>
      </AppContext.Provider>
    </ThemeProvider>
  </SafeAreaView>)
}

registerRootComponent(App);

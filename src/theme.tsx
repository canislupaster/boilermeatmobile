import {createTheme, createBox, createText, createRestyleComponent, backgroundColor, layout, spacing, LayoutProps, BackgroundColorProps, SpacingProps, VariantProps, createVariant, TypographyProps, typography, BoxProps as RestyleBoxProps, useRestyle, composeRestyleFunctions, boxRestyleFunctions, ColorProps, color, TextProps} from '@shopify/restyle';
import { ComponentClass, createContext, useContext, useEffect, useRef, useState } from 'react';
import * as ReactNative from 'react-native';
import React from 'react';
import Collapsible from 'react-native-collapsible';
import Ionicons from '@expo/vector-icons/Ionicons';
import { IconProps } from '@expo/vector-icons/build/createIconSet';
import { ModalProps } from 'react-native';
import app from './app';
import { EvilIcons } from '@expo/vector-icons';

export const userColors: [string,boolean][] = [
  ["#EEB76B", true],
  ["#E2703A", true],
  ["#9C3D54", true],
  ["#310B0B", false],
  ["#1A1A1B", false],
  ["#333F44", false],
  ["#37AA9C", true],
  ["#94F3E4", true]
];

export const sinceColors: string[] = [
  "#0a8238",
  "#bd8204",
  "#c72014"
];

export const sinceColorBreakpoints: number[] = [
  4*60,
  11.5*60,
];

export const theme = createTheme({
  colors: {
    none: "transparent",
    mainBackground: "#0d0f0d",
    cardPrimaryBackground: "#131716",
    active: "#012417",
    blood: "#a82424",
    text: "#f2f2f2",
    highlight: "#4ae862",
    background: "#191c1c",
    bad: "#591821",
    subtle: "#cdd1d1",
    disabled: "#636060",
    success: "#124a27",
    bgHighlight: "rgba(103, 240, 187,0.1)"
  },
  spacing: {
    none: 0,
    xs: 4,
    s: 8,
    m: 16,
    l: 24,
    xl: 40,
  },
  borderRadii: {
    none: 0,
    s: 3,
    m: 5,
    l: 7,
    xl: 17
  },
  textVariants: {
    med: {
      fontSize: 24,
      lineHeight: 26,
      fontFamily: "Montserrat-Med"
    },
    fat: {
      fontSize: 18,
      lineHeight: 22,
      fontFamily: "Montserrat"
    },
    big: {
      fontSize: 26,
      lineHeight: 28,
      fontFamily: "Montserrat"
    },
    header: {
      fontWeight: "500",
      fontSize: 34,
      lineHeight: 35,
      marginBottom: "s",
      fontFamily: "Montserrat"
    },
    defaults: {
      fontFamily: "Merriweather",
      fontSize: 18,
      lineHeight: 24,
      color: "text"
    }
  },
  inputVariants: {
    defaults: {
      padding: "s",
      backgroundColor: "background",
      paddingHorizontal: "m",
      borderRadius: "l",
      borderWidth: 1,
      borderColor: "highlight",
      color: "text",
      fontSize: 20
    }
  }
});

export type Theme = typeof theme;

const boxRestyle = composeRestyleFunctions<Theme, RestyleBoxProps<Theme>>(boxRestyleFunctions as any[]);
const colorRestyle = composeRestyleFunctions<Theme, ColorProps<Theme>>([color]);

export const Box = createBox<Theme>();
export const Text = createText<Theme>();
type BoxProps = RestyleBoxProps<Theme> & ReactNative.ViewProps;
export const Pressable = createRestyleComponent<RestyleBoxProps<Theme> & ReactNative.PressableProps, Theme>(boxRestyleFunctions as any[], ReactNative.Pressable);
export const Modal = createRestyleComponent<RestyleBoxProps<Theme> & ModalProps, Theme>([backgroundColor, layout, spacing], ReactNative.Modal);
export const Image = createRestyleComponent<LayoutProps<Theme> & BackgroundColorProps<Theme> & SpacingProps<Theme> & ReactNative.ImageProps, Theme>([backgroundColor, layout, spacing], ReactNative.Image);
export const ImageBackground = createRestyleComponent<LayoutProps<Theme> & BackgroundColorProps<Theme> & SpacingProps<Theme> & ReactNative.ImageBackgroundProps, Theme>([backgroundColor, layout, spacing], ReactNative.ImageBackground);
export const TextInput = createRestyleComponent<LayoutProps<Theme> & BackgroundColorProps<Theme> & SpacingProps<Theme> & TypographyProps<Theme> & ReactNative.TextInputProps & VariantProps<Theme,"inputVariants">, Theme>([backgroundColor, layout, typography, spacing, createVariant({themeKey: "inputVariants"})], ReactNative.TextInput);

type FormContext = {
  addInput: (key: string, focus: () => void, value: any) => void,
  removeInput: (key: string) => void,
  submitInput: (key: string) => void,
  setInputValue: (key: string, value: any) => void,
  doSubmit: () => void
};

const FormContext = createContext<FormContext | null>(null);
const useForm = () => useContext(FormContext);

const registerInput = (key: string, focus: () => void, value: any) => {
  const form = useForm();

  useEffect(() => {
    if (form!==null) form.addInput(key, focus, value);
    return () => {
      if (form!==null) form.removeInput(key);
    };
  }, []);
};

export function LabeledTextInput(props: ReactNative.TextInputProps & {label: string, name?: string}) {
  const form = useForm();
  const ref = useRef<ReactNative.TextInput>();
  const enabled = props.name!==undefined && form!==null;

  if (enabled) registerInput(props.name!!, () => ref.current?.focus(), props.value);
  
  return (
    <Box marginTop="m" >
      <Box borderTopRightRadius="l" borderTopLeftRadius="l" borderWidth={1} borderColor="highlight" padding="s" paddingLeft="m" >
        <Text fontSize={20} color="subtle" >{props.label}</Text>
      </Box>

      <TextInput {...props}
        ref={ref}
        style={{borderTopRightRadius: 0, borderTopWidth: 0, borderTopLeftRadius: 0}}
        onChangeText={(text) => {
          props.onChangeText?.(text);
          if (enabled) form.setInputValue(props.name!!, text);
        }}
        onSubmitEditing={(e) => {
          props.onSubmitEditing?.(e);
          if (enabled) form.submitInput(props.name!!);
        }} />
    </Box>
  );
}

export type ButtonProps = BoxProps & {onPress?: () => void, children?: React.ReactNode, disabled?: boolean, noWrapper?: boolean};

export function Button({onPress, children, disabled, noWrapper, ...rest}: ButtonProps) {
  let [pressed, setPressed] = useState(false);

  const form = useForm();

  return (
    <Pressable disabled={disabled} onPress={() => {
      onPress?.();
      if (form!==null) form.doSubmit();
    }}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      paddingHorizontal="s" borderRadius="l"
      borderWidth={1} borderColor="highlight" flexDirection="row"
      justifyContent="center" alignItems="center"
      marginTop="m" backgroundColor={disabled ? "disabled"
      : (pressed ? "active" : "cardPrimaryBackground")} {...rest} >
      {noWrapper ? children :
        <Text variant="big" fontSize={20} color={disabled ? "mainBackground" : "subtle"} padding="s" >
          {children}
        </Text>}
    </Pressable>
  );
}

export function Icon({name, onPress, icon, iconProps, iconStyle, ...rest}: BoxProps & {onPress?: () => void, name: string, icon: ComponentClass<IconProps<any>>, iconProps?: Partial<IconProps<any>>, iconStyle?: ColorProps<Theme>}) {
  const props = useRestyle(boxRestyle, rest);
  const colorProps = useRestyle(colorRestyle, iconStyle ?? {color: "text"} as ColorProps<Theme>);

  const IconC = icon; //...

  return (
    <Box borderRadius="l" padding="xs" {...props} >
      <IconC name={name as any} size={30} {...colorProps} {...iconProps} />
    </Box>
  );
}


export function IconButton({name, onPress, icon, ...rest}: BoxProps & {onPress?: () => void, name: string, icon: ComponentClass<IconProps<any>>}) {
  const props = useRestyle(boxRestyle, rest);

  let [pressed, setPressed] = useState(false);

  return (
    <ReactNative.Pressable onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      >
      <Icon name={name as any} icon={icon} backgroundColor={pressed ? "active" : "background"} {...props} />
    </ReactNative.Pressable>
  );
}

export type CardProps = BoxProps & {title?: React.ReactNode, icon?: React.ReactNode, children?: React.ReactNode, iconFirst?: boolean, headerProps?: BoxProps, headerPress?: () => void, collapsed?: boolean};

export function Card({title, icon, children, iconFirst, headerPress, headerProps, collapsed, ...rest}: CardProps) {
  const props = useRestyle(boxRestyle, rest);
  const hprops = useRestyle(boxRestyle, headerProps ?? {});
  
  //animate collapse/expand
  return (
    <Box marginVertical="m" backgroundColor="cardPrimaryBackground" borderColor="highlight" borderWidth={1} {...props} >
      <Pressable onPress={headerPress} 
        padding="m" paddingVertical="s" 
        flexDirection={iconFirst===true ? "row-reverse" : "row"}
        justifyContent={iconFirst===true ? "flex-end" : "space-between"} alignItems="center" {...hprops} >

        {typeof title == "string" ? 
          <Box flexShrink={1} ><Text variant="big" fontSize={20} marginLeft={iconFirst===true ? "m" : "none"} >{title}</Text></Box> : title}
        {icon}
      </Pressable>
      {<Collapsible collapsed={collapsed ?? false} >
        <Box marginBottom="l" paddingTop="m" paddingHorizontal="m" >
          {children}
        </Box>
      </Collapsible>}
    </Box>
  );
}

export function Form(props: {children?: React.ReactNode,
  onSubmit: (values: Record<string,any>) => void}) {

  let [inputs, setInputs] = useState<{ focus: () => void, key: string, value: any }[]>([]);

  let sub = () => {
    props.onSubmit?.(
      Object.fromEntries(inputs.map((x) => [x.key, x.value]))
    );
  };

  return <FormContext.Provider value={{
    addInput(key, focus, value) {
      setInputs([...inputs, {key, focus, value}]);
    },
    removeInput(key) {
      setInputs(inputs.filter((x) => x.key!==key));
    },
    submitInput(key) {
      let idx = inputs.findIndex((x) => x.key===key);
      if (idx===inputs.length-1) sub();
      else inputs[idx+1].focus();
    },
    doSubmit() { sub(); },
    setInputValue(key, value) {
      setInputs(inputs.map((x) => x.key===key ? {...x, value} : x));
    }
  }} >
    {props.children}
  </FormContext.Provider>;
}

export function ErrorCard({name, message}: { name: string, message: string }) {
  return <Card width="auto" title={name} iconFirst={true} backgroundColor="bad" borderColor="blood" icon={
    <Ionicons name="alert-circle-sharp" size={24} color="white" />
  }>
    <Text>{message}</Text>
  </Card>;
}

export function Tabs<X extends string>({tabs, selected, onSelect}: {tabs: X[], selected: X, onSelect: (tab: X) => void}) {
  return <Box flexDirection="row" justifyContent="space-between" alignItems="center" >
    {tabs.map((x) => {
      let brl: "none" | "xl" = x==selected ? "none" : "xl";
      return <Box key={x} padding="s" borderTopWidth={2} borderTopColor={x==selected ? "highlight" : "background"} flexGrow={1} borderRadius="m" borderTopLeftRadius={brl} borderTopRightRadius={brl} backgroundColor={selected==x ? "mainBackground" : "background"} flexDirection="column" justifyContent="center" alignItems="center" >
        <Pressable onPress={() => onSelect(x)} >
          <Text variant="med" >{x}</Text>
        </Pressable>
      </Box>;
    })}
  </Box>;
}

export function ModalOutside(props: ModalProps & {close: () => void, transparency?: number, container?: boolean, zind?: number}) {
  const abs: ReactNative.StyleProp<ReactNative.ViewStyle> = {position: "absolute", left: 0, top: 0, right: 0, bottom: 0, zIndex: props.zind};
  return <Modal onRequestClose={props.close} transparent {...props} >
    <Pressable onPress={props.close} style={{backgroundColor: `rgba(0,0,0,${props.transparency ?? 0.0})`, ...abs}} >
    </Pressable>
    {props.container ? <Box shadowColor="mainBackground"
      shadowRadius={200} shadowOffset={{width: -150, height: -100}}
      shadowOpacity={1.0}
      style={abs} flexDirection="column"
      justifyContent="center" alignItems="center" paddingHorizontal="xl" >
      {props.children}
    </Box> : props.children}
  </Modal>;
}

export function BackButton(props: {onPress: () => void} & BoxProps) {
  return <IconButton name="arrow-back" marginRight="m" backgroundColor="none" icon={Ionicons} {...props} />;
}

export function ErrorModal({closeModal, name, message}: {closeModal: () => void, name: string, message: string}) {
  return <Card margin="m" width="100%" backgroundColor="background" borderColor="highlight" title={name} icon={<IconButton name="close" onPress={closeModal} icon={EvilIcons} />}>
    <Text>{message}</Text>
  </Card>;
}

export function ChoiceModal({choose, name, message, action}: {choose: (act: boolean) => void, name: string, message: string, action: string}) {
  return <Card margin="m" width="100%" backgroundColor="background" borderColor="highlight" title={name} >
    <Text>{message}</Text>
    <Box flexDirection="row" alignItems="center" >
      <Button borderColor="background" marginRight="m" onPress={() => choose(false)} >Cancel</Button>
      <Button onPress={() => choose(true)} >{action}</Button>
    </Box>
  </Card>;
}

export function Link({children, onPress, ...rest}: {children?: React.ReactNode, onPress?: () => void} & TextProps<Theme>) {
  let [pressed, setPressed] = useState(false);
  return <Text color="highlight" textDecorationLine="underline"
    style={{backgroundColor: pressed ? theme.colors.bgHighlight : "transparent"}}
    onPress={onPress}
    onPressIn={() => setPressed(true)}
    onPressOut={() => setPressed(false)}  {...rest} >
      {children}
  </Text>;
}

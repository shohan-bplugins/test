import { createContext, useContext } from "react";

export const CustomizeContext = createContext();

export const useCustomize = () => useContext(CustomizeContext);
    
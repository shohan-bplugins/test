declare module "*.css";

// HTML Invoker Commands (`commandfor` / `command`), which Polaris web
// components use to open `s-modal` from a plain <button>. React 18's DOM
// typings predate the attributes; React passes them through unchanged.
import "react";
declare module "react" {
  interface ButtonHTMLAttributes<T> {
    commandFor?: string;
    command?: string;
  }
}

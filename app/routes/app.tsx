import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import {
  Outlet,
  useLoaderData,
  useLocation,
  useNavigate,
  useRouteError,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import { getOrCreateUser } from "~/lib/billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (session?.shop) {
    await getOrCreateUser(session.shop);
  }
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

type NavItem = {
  href: string;
  label: string;
  exact?: boolean;
  home?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/app", label: "Home", exact: true, home: true },
  { href: "/app/products", label: "Product 3D Models" },
  { href: "/app/models", label: "3D Model Library" },
  { href: "/app/documentation", label: "Documentation" },
  { href: "/app/pricing", label: "Pricing" },
  { href: "/app/setup", label: "Setup" },
];

function isActivePath(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(item.href + "/");
}

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        {NAV_ITEMS.map((item) => {
          const active = isActivePath(pathname, item);
          const useChildHref = active && pathname !== item.href;
          const homeAttrs = item.home ? { rel: "home" as const } : {};
          const clickHandler = useChildHref
            ? (e: Event) => {
                e.preventDefault();
                e.stopPropagation();
                navigate(item.href);
              }
            : undefined;

          return (
            <s-link
              key={item.href}
              href={useChildHref ? pathname : item.href}
              onClick={clickHandler}
              {...homeAttrs}
            >
              {item.label}
            </s-link>
          );
        })}
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

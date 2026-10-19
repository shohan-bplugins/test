import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { login } from "../../shopify.server";
import LoginCard from "../../components/LoginCard/LoginCard";

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`, {
      target: "_parent",
    });
  }

  return json({ showForm: Boolean(login) });
};

// Outside the Shopify admin (no ?shop=): show the login card. Inside the
// admin the loader above redirects to /app before this renders.
export default function App() {
  const { showForm } = useLoaderData();

  return showForm ? (
    <LoginCard action="/auth/login" />
  ) : (
    <s-box padding="large">
      <s-heading>Audio Player by bPlugins</s-heading>
      <s-paragraph>Open the app from your Shopify admin.</s-paragraph>
    </s-box>
  );
}

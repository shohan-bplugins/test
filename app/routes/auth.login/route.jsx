import { json } from "@remix-run/node";
import { useActionData, useLoaderData } from "@remix-run/react";
import { login } from "../../shopify.server";
import { loginErrorMessage } from "./error.server";
import LoginCard from "../../components/LoginCard/LoginCard";

export const loader = async ({ request }) => {
  const errors = loginErrorMessage(await login(request));

  return json({ errors });
};

export const action = async ({ request }) => {
  try {
    const errors = loginErrorMessage(await login(request));

    return json({
      errors,
    });
  } catch (error) {
    console.error("Login error:", error);
    throw error;
  }
};

export default function Auth() {
  const loaderData = useLoaderData();
  const actionData = useActionData();
  const { errors } = actionData || loaderData;

  return <LoginCard error={errors?.shop} />;
}

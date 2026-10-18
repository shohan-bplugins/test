import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { fieldValue } from "~/components/polaris/helpers";
import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData, useSubmit } from "react-router";

import { login } from "../../shopify.server";
import { loginErrorMessage } from "./error.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));

  return { errors };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));

  return {
    errors,
  };
};

export default function Auth() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [shop, setShop] = useState("");
  const submit = useSubmit();
  const { errors } = actionData || loaderData;

  return (
    <AppProvider embedded={false}>
      <s-page>
        <s-section heading="Log in">
          <s-text-field
            name="shop"
            label="Shop domain"
            details="example.myshopify.com"
            value={shop}
            /*
             * onInput, not onChange. React 18 routes onChange through its
             * ChangeEventPlugin, which only produces the event for <select>,
             * <input type=file>, text inputs and checkboxes — a custom element
             * matches none of them, so the handler was never called and this
             * field's state never updated. See components/polaris/helpers.
             */
            onInput={(e) => setShop(fieldValue(e))}
            autocomplete="on"
            error={errors.shop}
          ></s-text-field>
          {/*
            Submitted explicitly rather than by a <Form> wrapper. A Polaris
            button renders its real <button> inside shadow DOM, so it is not
            form-associated and a type="submit" on it has no form to submit.
          */}
          <s-button
            variant="primary"
            onClick={() => submit({ shop }, { method: "post" })}
          >
            Log in
          </s-button>
        </s-section>
      </s-page>
    </AppProvider>
  );
}

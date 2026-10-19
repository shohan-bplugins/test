import React, { useRef, useState } from "react";
import { Form } from "@remix-run/react";
import { WebTextField } from "../PolarisWeb/fields";

// Shop-domain login card used outside the embedded admin (/auth/login and the
// root landing page). The native hidden input guarantees the value is posted
// with the form regardless of web-component form support.
export default function LoginCard({ action, error }) {
  const formRef = useRef(null);
  const [shop, setShop] = useState("");

  return (
    <s-box padding="large" maxInlineSize="480px">
      <s-section>
        <Form method="post" action={action} ref={formRef}>
          <s-stack gap="base">
            <s-heading>Log in to Audio Player by bPlugins</s-heading>
            <WebTextField
              label="Shop domain"
              details="example.myshopify.com"
              value={shop}
              error={error || undefined}
              autocomplete="on"
              onChange={setShop}
            />
            <input type="hidden" name="shop" value={shop} />
            <s-stack direction="inline">
              <s-button
                variant="primary"
                onClick={() => formRef.current?.requestSubmit()}
              >
                Log in
              </s-button>
            </s-stack>
          </s-stack>
        </Form>
      </s-section>
    </s-box>
  );
}

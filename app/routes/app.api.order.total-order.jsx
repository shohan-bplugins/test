import { authenticate } from "../shopify.server";

export async function action({ request }) {
  return { name: "Md Shohanur Rahman" };
}
export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(
    `#graphql
  query {
    shop {
      name
      currencyCode
      checkoutApiSupported
      taxesIncluded
      resourceLimits {
        maxProductVariants
      }
    }
  }`,
  );

  const data = await response.json();

  return { name: "Md Shohanur Rahman" };
}

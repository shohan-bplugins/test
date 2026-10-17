import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useState, useEffect } from "preact/hooks";

// Target: admin.product-variant-details.configuration.render (see shopify.extension.toml).
export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const {
    extension: { target },
    i18n,
  } = shopify;
  const productVariant = useProductVariant();
  return (
    <s-stack direction="block">
      <s-text>{i18n.translate("welcome", { target })}</s-text>
      {productVariant?.productVariantComponents.map((component) => (
        <s-text key={component.id}>{component.title}</s-text>
      ))}
    </s-stack>
  );
}

function useProductVariant() {
  const { data, query } = shopify;
  const productVariantId = data?.selected[0].id;
  const [productVariant, setProductVariant] = useState(null);

  useEffect(() => {
    query(
      `#graphql
      query GetProductVariant($id: ID!) {
        productVariant(id: $id) {
          id
          title
          productVariantComponents(first: 100) {
            nodes {
              productVariant {
                id
                title
              }
            }
          }
        }
      }
      `,
      { variables: { id: productVariantId } },
    ).then(({ data, errors }) => {
      if (errors) {
        console.error(errors);
      } else {
        const { productVariantComponents, ...variant } = data.productVariant;
        setProductVariant({
          ...variant,
          productVariantComponents: productVariantComponents.nodes.map(
            ({ productVariant }) => ({ ...productVariant }),
          ),
        });
      }
    });
  }, [productVariantId, query]);

  return productVariant;
}

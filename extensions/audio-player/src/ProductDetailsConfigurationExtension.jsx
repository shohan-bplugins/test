import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useState, useEffect } from "preact/hooks";

// Target: admin.product-details.configuration.render (see shopify.extension.toml).
export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const {
    extension: { target },
    i18n,
  } = shopify;
  const product = useProduct();
  return (
    <s-stack direction="block">
      <s-text>{i18n.translate("welcome", { target })}</s-text>
      {product?.bundleComponents.map((component) => (
        <s-text key={component.id}>{component.title}</s-text>
      ))}
    </s-stack>
  );
}

function useProduct() {
  const { data, query } = shopify;
  const productId = data?.selected[0].id;
  const [product, setProduct] = useState(null);

  useEffect(() => {
    query(
      `#graphql
      query GetProduct($id: ID!) {
        product(id: $id) {
          id
          title
          bundleComponents(first: 100) {
            nodes {
              componentProduct {
                id
                title
              }
            }
          }
        }
      }
      `,
      { variables: { id: productId } },
    ).then(({ data, errors }) => {
      if (errors) {
        console.error(errors);
      } else {
        const { bundleComponents, ...product } = data.product;
        setProduct({
          ...product,
          bundleComponents: bundleComponents.nodes.map(
            ({ componentProduct }) => ({ ...componentProduct }),
          ),
        });
      }
    });
  }, [productId, query]);

  return product;
}

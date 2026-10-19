import {
  json,
  useActionData,
  useLoaderData,
  useSubmit,
} from "@remix-run/react";
import { useEffect } from "react";
import { authenticate } from "../shopify.server";

export default function FileCreate() {
  const submit = useSubmit();
  const actionData = useActionData();
  const loaderData = useLoaderData();

  function createFile() {
    submit({ name: "Shohan" }, { method: "POST" });
  }

  return <button onClick={createFile}>Working fine</button>;
}

export async function loader() {
  return { message: "working fine on loader" };
}

export async function action({ request }) {
  const { admin } = await authenticate.admin(request);

  try {
    // const createFileQuery = await admin.graphql(
    //     `#graphql
    //       mutation fileCreate($files: [FileCreateInput!]!) {
    //       fileCreate(files: $files) {
    //         files {
    //           id
    //           fileStatus
    //         }
    //         userErrors {
    //           field
    //           message
    //         }
    //       }
    //   }
    //       `,
    //     {
    //       variables: {
    //         files: {
    //           alt: "EXTERNAL_VIDEO",
    //           contentType: 'EXTERNAL_VIDEO',
    //           originalSource: "https://youtu.be/e6zhNJOqr2k"
    //         }
    //       }
    //     }
    //   );
    const createFileQuery = await admin.graphql(
      `#graphql
              mutation fileCreate($files: [FileCreateInput!]!) {
              fileCreate(files: $files) {
                files {
                  id
                  fileStatus
                }
                userErrors {
                  field
                  message
                }
              }
          }
              `,
      {
        variables: {
          files: [
            {
              alt: "EXTERNAL_VIDEO",
              contentType: "EXTERNAL_VIDEO",
              originalSource: "https://youtu.be/e6zhNJOqr2k",
            },
          ],
        },
      },
    );
    const createFileResult = await createFileQuery.json();
    return createFileResult;
  } catch (error) {
    return { message: error.message };
  }
}

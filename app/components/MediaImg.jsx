import React, { useState, useCallback, useEffect, useRef } from "react";
import { useSubmit, useFetcher, useNavigation } from "@remix-run/react";
import { Modal } from "@shopify/polaris";
import "../styles/mediaUpload.css";
import {
  DragHandleIcon,
  ListBulletedIcon,
  NoteIcon,
  PlusIcon,
} from "@shopify/polaris-icons";

import VideoModal from "./VideoModal/VideoModal";
import { useAppBridge } from "@shopify/app-bridge-react";
import ImgModal from "./VideoModal/ImgModal";

// This would typically be in a separate file
const SHOPIFY_SHOP = "shohan01.myshopify.com";
const SHOPIFY_ACCESS_TOKEN = "shpua_e3777422dcfdcf5320cabd7861f4a44f";

// export const loader = async ({ request }) => {
//   const { admin } = await authenticate.admin(request);
//   const response = await admin.graphql(
//     `#graphql
//     query MyQuery {
//       files(reverse: true, first: 250) {
//         edges {
//           node {
//             id
//             createdAt
//             alt
//             preview {
//               image {
//                 url(transform: {})
//                 src
//               }
//             }
//             ... on GenericFile {
//               id
//               url
//               mimeType
//               alt
//               originalFileSize
//             }
//             ... on Video {
//               id
//               mediaContentType
//               sources {
//                   fileSize
//                   url
//                 }
//               preview {
//                 image {
//                   src
//                 }
//               }
//               sources {
//                 fileSize
//                 format
//                 mimeType
//                 url
//               }
//               filename
//               originalSource {
//                fileSize
//                 mimeType
//              }
//             }
//           }
//         }
//         pageInfo {
//           hasPreviousPage
//           hasNextPage
//           endCursor
//           startCursor
//         }
//       }
//     }`,
//   );
//   const result = await response.json();
//   const allFiles = result?.data?.files?.edges.filter(
//     (file) =>
//       file?.node?.mimeType?.includes("video") === true ||
//       file.node.mediaContentType === "EXTERNAL_VIDEO" ||
//       file.node.mediaContentType === "VIDEO",
//   );

//   return json({
//     allFiles,
//     result,
//   });
// };

// export const action = async ({ request }) => {
//   const { admin } = await authenticate.admin(request);
//   const formData = await request.formData();
//   const file = formData.get("file");

//   try {
//     let stagedUpload;
//     if (request.method === "POST") {
//       // Step 1: Create a staged upload
//       const response = await admin.graphql(
//         `#graphql
//         mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
//           stagedUploadsCreate(input: $input) {
//             stagedTargets {
//                url
//                resourceUrl
//               parameters {
//                  name
//                value
//               }
//             }
//            }
//          }`,
//         {
//           variables: {
//             input: [
//               {
//                 filename: formData.get("name"),
//                 mimeType: formData.get("type"),
//                 httpMethod: "POST",
//                 resource:
//                   formData.get("type")?.split("/")[0].toUpperCase() === "AUDIO"
//                     ? "FILE"
//                     : formData.get("type")?.split("/")[0].toUpperCase(),
//                 fileSize: String(formData.get("size")),
//               },
//             ],
//           },
//         },
//       );

//       const stagedUploadResult = await response.json();

//       stagedUpload =
//         stagedUploadResult?.data?.stagedUploadsCreate?.stagedTargets?.[0];
//       return json({ stagedUpload });
//     } else if (request.method === "PUT") {
//       if (formData.get("contentType") == "EXTERNAL_VIDEO") {
//         const createFileQuery = await admin.graphql(
//           `#graphql
//         mutation fileCreate($files: [FileCreateInput!]!) {
//           fileCreate(files: $files) {
//             files {
//               id
//               fileStatus
//             }
//             userErrors {
//               field
//               message
//             }
//           }
//         }`,
//           {
//             variables: {
//               files: {
//                 contentType: "EXTERNAL_VIDEO",
//                 originalSource: formData.get("originalSource"),
//               },
//             },
//           },
//         );
//         const createFileResult = await createFileQuery.json();
//         return json({
//           createFileResult: createFileResult?.data?.fileCreate?.files?.[0],
//         });
//       } else if (formData.get("ids")) {
//         if (formData.get("ids")) {
//           const status = await admin.graphql(
//             `
//             query FileStatusPoll($ids: [ID!]!) {
//                 nodes(ids: $ids) {
//                   __typename
//                   ... on Node {
//                     id
//                     __typename
//                   }
//                   ... on File {
//                     alt
//                     fileStatus
//                     fileErrors {
//                       code
//                       __typename
//                     }
//                     __typename
//                   }
//                   ... on GenericFile {
//                     id
//                     createdAt
//                     url
//                     __typename
//                   }
//                   ... on MediaImage {
//                     id
//                     createdAt
//                     image {
//                       id
//                       thumbnail: url(transform: {maxWidth: 150})
//                       preview: url(transform: {maxWidth: 430})
//                       original: url
//                       width
//                       height
//                       __typename
//                     }
//                     __typename
//                   }
//                   ...VideoFragment
//                   ...ExternalVideoFragment
//                   ...Model3dFragment
//                 }
//               }

//               fragment VideoFragment on Video {
//                 id
//                 createdAt
//                 alt
//                 duration
//                 originalSource {
//                   url
//                   width
//                   height
//                   format
//                   mimeType
//                   __typename
//                 }
//                 sources {
//                   url
//                   width
//                   height
//                   format
//                   mimeType
//                   __typename
//                 }
//                 ...FilePreviewFragment
//                 __typename
//               }

//               fragment FilePreviewFragment on File {
//                 preview {
//                   status
//                   image {
//                     id
//                     width
//                     height
//                     url
//                     transformedSrc: url(transform: {maxWidth: 200, maxHeight: 200})
//                     __typename
//                   }
//                   __typename
//                 }
//                 __typename
//               }

//               fragment ExternalVideoFragment on ExternalVideo {
//                 id
//                 createdAt
//                 alt
//                 fileStatus
//                 originUrl
//                 ...FilePreviewFragment
//                 __typename
//               }

//               fragment Model3dFragment on Model3d {
//                 id
//                 createdAt
//                 alt
//                 fileStatus
//                 sources {
//                   format
//                   url
//                   filesize
//                   __typename
//                 }
//                 originalSource {
//                   url
//                   format
//                   mimeType
//                   filesize
//                   __typename
//                 }
//                 ...FilePreviewFragment
//                 __typename
//               }

//             `,
//             {
//               variables: {
//                 ids: formData.get("ids"),
//               },
//             },
//           );
//           const statusResult = await status.json();

//           return json({
//             status: statusResult?.data?.nodes,
//             id: formData.get("ids"),
//           });
//         }
//       } else {
//         // Step 3: Create the file record in Shopify

//         const createFileQuery = await admin.graphql(
//           `#graphql
//         mutation fileCreate($files: [FileCreateInput!]!) {
//           fileCreate(files: $files) {
//             files {
//               id
//               fileStatus
//             }
//             userErrors {
//               field
//               message
//             }
//           }
//         }`,
//           {
//             variables: {
//               files: {
//                 alt: formData.get("name"),
//                 contentType:
//                   formData.get("type")?.split("/")[0].toUpperCase() === "AUDIO"
//                     ? "FILE"
//                     : formData.get("type")?.split("/")[0].toUpperCase(),
//                 originalSource: formData.get("resourceUrl"),
//               },
//             },
//           },
//         );

//         // Log the entire response

//         const createFileResult = await createFileQuery.json();

//         // // const createFileResult = await makeGraphQLRequest(createFileQuery, createFileVariables);
//         const uploadedFile = createFileResult?.fileCreate?.files[0];
//         return json({
//           id: uploadedFile?.id,
//           name: uploadedFile?.filename,
//           url: uploadedFile?.url,
//           size: uploadedFile?.originalFileSize,
//           type: file?.type,
//           createFileResult: createFileResult?.data?.fileCreate?.files?.[0],
//         });
//       }
//     }

//     return json({ stagedUpload });
//   } catch (error) {
//     console.error("Error uploading file:", error);
//     return json({ error: "Failed to upload file" }, { status: 500 });
//   }
// };

export default function ImgUploadModal({
  inputValues,
  setInputValues,
  isHiddenUploadOption,
  setAddPosterModalActive,
  setAddOverlayLogoModalActive,
  options,
  handleSelectChange,
  isGridView,
  previewImg,
  handleScroll,
  handleDropZoneDrop,
  isUploading,
  uploadedFile,
  uploadedAndSelectedImg,
  setUploadedAndSelectedImg,
  uploadedAndSelectedLogo,
  setUploadedAndSelectedLogo,
  fileUpload,
  filteredFiles,
  selectedImgs,
  toggleImgSelection,
  setPreviewImg,
  files,
  addPosterModalActive,
  confirmNewURL,
  newUrl,
  setNewUrl,
  toastMarkup,
  actionData,
  isLoading,
  uploadImage,
  loadNextPage,
  loadPrevPage,
  pageInfo,
  addOverlayLogoModalActive,
  uploadProgress,
}) {
  const [imageUrl, setImageUrl] = useState("");
  const [imageLogo, setImageLogo] = useState("");

  return (
    <s-box>
      <ImgModal
        img={{
          img: {
            inputValues,
            setInputValues,
            isHiddenUploadOption,
            setAddPosterModalActive,
            setAddOverlayLogoModalActive,
            options,
            handleSelectChange,
            isGridView,
            previewImg,
            handleScroll,
            handleDropZoneDrop,
            isUploading,
            uploadedFile,
            uploadedAndSelectedImg,
            setUploadedAndSelectedImg,
            uploadedAndSelectedLogo,
            setUploadedAndSelectedLogo,
            fileUpload,
            filteredFiles,
            selectedImgs,
            toggleImgSelection,
            setPreviewImg,
            isLoading,
            actionData,
            loadNextPage,
            loadPrevPage,
            pageInfo,
            imageUrl,
            setImageUrl,
            imageLogo,
            setImageLogo,
            uploadImage,
            addPosterModalActive,
            uploadProgress,
          },
        }}
      />
      {/* <Modal
        open={addPosterModalActive}
        onClose={() => {
          setAddPosterModalActive(false);
          shopify.modal.show("upload-img");
        }}
        title="Input Image URL"
        primaryAction={{
          content: "Add New Image",
          onAction: () => {
            uploadImage({
              name: "Image URL",
              type: "IMAGE",
              resourceUrl: imageUrl,
            });
            shopify.modal.show("upload-img");
            setAddPosterModalActive(false);
            setImageUrl("");
          },
          disabled: !imageUrl,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => {
              setAddPosterModalActive(false);
              shopify.modal.show("upload-img");
            },
          },
        ]}
      >
        <Modal.Section>
          <TextField
            label="Image URL"
            value={imageUrl}
            onChange={setImageUrl}
            autoComplete="off"
          />
        </Modal.Section>
      </Modal> */}
      <Modal
        open={addOverlayLogoModalActive}
        onClose={() => {
          setAddOverlayLogoModalActive(false);
          shopify.modal.show("upload-img-logo");
        }}
        title="Input Image URL"
        primaryAction={{
          content: "Add New Image",
          onAction: () => {
            uploadImage({
              name: "Image URL",
              type: "IMAGE",
              resourceUrl: imageLogo,
            });
            shopify.modal.show("upload-img-logo");
            setAddOverlayLogoModalActive(false);
            setImageLogo("");
          },
          disabled: !imageLogo,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => {
              setAddOverlayLogoModalActive(false);
              shopify.modal.show("upload-img-logo");
            },
          },
        ]}
      >
        <Modal.Section>
          <s-url-field
            label="Image URL"
            value={imageLogo}
            onInput={(e) => setImageLogo(e.target.value)}
            autocomplete="off"
          />
        </Modal.Section>
      </Modal>

      {toastMarkup}
    </s-box>
  );
}

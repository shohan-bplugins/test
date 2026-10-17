import React from "react";
import Modal from "../PolarisWeb/WebModal";

// Tutorial video in a Polaris modal. The iframe only exists while open, so
// closing the modal also stops playback.
export default function YouTubeModal({ open, onClose, src, title }) {
  if (!open) return null;
  return (
    <Modal open onClose={onClose} title={title} size="large">
      <Modal.Section>
        <iframe
          src={src}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
          style={{ width: "100%", aspectRatio: "16 / 9", border: 0 }}
        />
      </Modal.Section>
    </Modal>
  );
}

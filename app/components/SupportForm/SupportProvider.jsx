import React, { createContext, useContext, useEffect, useState } from "react";
import { useFetcher } from "@remix-run/react";
import Modal from "../PolarisWeb/WebModal";
import SupportForm from "./SupportForm";

const SupportContext = createContext(() => {});

// Opens the shared "Contact support" modal, optionally with a pre-filled subject:
//   const openSupport = useSupport();
//   <button onClick={() => openSupport()}>Support</button>
export const useSupport = () => useContext(SupportContext);

// One support modal for the whole app. The merchant's name/email are fetched
// only when it first opens, so pages don't pay for them on load.
export default function SupportProvider({ children }) {
  // null = closed; otherwise the subject the form opens with.
  const [subject, setSubject] = useState(null);
  const merchant = useFetcher();

  useEffect(() => {
    if (subject !== null && merchant.state === "idle" && !merchant.data) {
      merchant.load("/app/support-ticket");
    }
  }, [subject]);

  return (
    <SupportContext.Provider value={(initial = "") => setSubject(initial)}>
      {children}
      {subject !== null && (
        <Modal open onClose={() => setSubject(null)} title="Contact support">
          <Modal.Section>
            <SupportForm
              defaultName={merchant.data?.name || ""}
              defaultEmail={merchant.data?.email || ""}
              initialSubject={subject}
            />
          </Modal.Section>
        </Modal>
      )}
    </SupportContext.Provider>
  );
}

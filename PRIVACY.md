# Privacy Policy — Easy 3D Viewer

**Effective date:** August 16, 2026
**Last updated:** August 31, 2026

Easy 3D Viewer ("the App", "we", "us", "our") is a Shopify app developed and
operated by bPlugins LLC. The App lets a Shopify merchant upload 3D model files and
display them on their online store through a theme app block.

This policy explains what personal information the App collects, why we collect it,
who we share it with, and the choices available to merchants and to their customers.
It applies to the App only — it does not cover the merchant's own store, which is
governed by that merchant's privacy policy.

---

## 1. Who this policy covers

| Group | What it means here |
| --- | --- |
| **Merchants** | Shopify store owners and staff who install and use the App in the Shopify admin. |
| **Store visitors** | People who browse a merchant's storefront and view a 3D model rendered by the App. |

---

## 2. Information we collect

### 2.1 Information we receive from Shopify when the App is installed

When a merchant installs the App and completes authorization, we query the Shopify
Admin API for the store's own details and receive:

- **Store identifiers** — the `.myshopify.com` domain, the store's primary domain, and
  the Shopify store ID.
- **Store contact and profile details** — the store owner's name, the store's contact
  email address, phone number, street address, country, store creation date, and
  current Shopify plan name.
- **Merchant account details** — for online access tokens, the first name, last name,
  email address, locale, email-verified status, and whether the user is the account
  owner or a collaborator.
- **An API access token** used to make authorized requests to the store on the
  merchant's behalf.

We read the same store details again when the App is uninstalled and when a
subscription changes status, so that our records stay current. In the uninstall case
they arrive in Shopify's `app/uninstalled` webhook payload.

### 2.2 Permissions the App requests

The App requests these Shopify access scopes and no others:

- `write_products` — to read the merchant's products and attach 3D models to them.
- `write_files` — to upload 3D model files into the store's Shopify Files library.
- `write_themes` — to detect and manage the theme app blocks that display the viewer.

**The App does not request, receive, or store customer records, order data, or
payment data.** We have no access to your customers' names, email addresses, shipping
addresses, or payment details.

### 2.3 Information merchants provide directly

- **3D model files** uploaded through the App (for example `.glb` and `.gltf` files),
  along with the file name and file size.
- **Viewer configuration** — display settings such as camera angle, lighting,
  background, auto-rotate, and similar presentation options.
- **Onboarding and setup state** — which setup steps the merchant has completed, and
  whether the merchant has viewed the pricing page.

### 2.4 Support requests

If a merchant uses the support form inside the App, we send the name, email address,
subject and message entered on the form to bPlugins' support ticket system, together
with the store's `.myshopify.com` domain, the name of this App, and whether the store
is on a paid plan. The shop domain and plan are added by us rather than typed by the
merchant, so that support can identify the store without asking.

### 2.5 Billing information

If a merchant subscribes to a paid plan, we store the plan name, price, subscription
status, Shopify charge ID, trial and billing dates, and activation or cancellation
dates. **Billing is handled entirely by Shopify's Billing API.** We never see or store
credit card numbers or any other payment instrument details.

### 2.6 Usage analytics in the Shopify admin

Pages of the App inside the Shopify admin include **Google Analytics 4** and
**Microsoft Clarity**. These collect:

- Pages viewed within the App, timestamps, referrer, and navigation paths.
- Device, browser, operating system, screen size, approximate location derived from
  IP address, and a randomly generated visitor identifier stored in a cookie.
- Microsoft Clarity additionally records **session replays** — interactions such as
  clicks, scrolls, and mouse movement within the App's admin interface — and
  heatmaps of that activity.
- The merchant's shop domain, which we send as a user identifier so that support
  requests can be matched to the correct store.

We use this strictly to understand how merchants use the App, to find bugs, and to
improve the interface.

**These analytics run on merchant-facing admin pages only.** The public storefront
viewer embed, the shareable model links, and the authentication screens carry no
analytics scripts, so **your store visitors are not tracked by these tools.**

### 2.7 Information collected from store visitors

When a store visitor loads a page containing a 3D model, their browser requests the
model file and its configuration — either directly from Shopify's CDN, or through the
App's proxy on the store's own domain (`/apps/viewer-3d/...`). Our server processes
proxied requests and may record standard server log data — IP address, user agent,
timestamp, and the requested model ID — for security, abuse prevention, and
diagnostics. **We do not set advertising cookies, build visitor profiles, or run
behavioural tracking on the storefront.**

### 2.8 Server logs

Our servers keep operational logs of errors and API requests. These may incidentally
contain a shop domain, an IP address, or a request path.

---

## 3. How we use information

We use the information described above to:

- Authenticate the merchant's store and maintain an active session.
- Store, serve, and render 3D models on the merchant's storefront.
- Enforce plan limits, such as the maximum number of models and products per plan.
- Process subscriptions, upgrades, and cancellations through Shopify Billing.
- Provide customer support and respond to enquiries.
- Send transactional and product communications about the App, such as installation
  confirmations, onboarding guidance, and service notices.
- Diagnose faults, monitor performance, and improve the App.
- Detect and prevent abuse, fraud, and security incidents.
- Meet our legal and tax obligations.

**We do not sell personal information, and we do not share it with advertisers or data
brokers.**

---

## 4. Legal bases for processing (EEA and UK merchants)

Where the GDPR or UK GDPR applies, we rely on:

- **Performance of a contract** — to provide the App you installed and to bill for it.
- **Legitimate interests** — to secure the service, prevent abuse, improve the product,
  and communicate with merchants about the App, balanced against your rights.
- **Consent** — where required for non-essential analytics cookies; you may withdraw it
  at any time as described in Section 8.
- **Legal obligation** — to retain records required by tax and accounting law.

---

## 5. Where your data is stored

**3D model files** uploaded through the App are stored in **the merchant's own Shopify
Files library**, on Shopify's infrastructure, and are served from Shopify's CDN. We
store only a reference to each file (its Shopify file ID and URL), its name, its size,
and its viewer configuration.

**Model references and viewer settings are also written into metafields on the
merchant's own store**, which is how the theme block reads them without calling out to
us. That copy is part of the merchant's Shopify data and stays under the merchant's
control.

**App data** — sessions, plan records, model references, and configuration — is also
stored in our application database, hosted on MongoDB Atlas, with the App itself
running on servers operated by our hosting provider. Data may be processed in
countries other than the merchant's own. Where personal data is transferred out of the
EEA or the UK, we rely on Standard Contractual Clauses or an equivalent recognized
transfer mechanism.

---

## 6. Third parties we share information with

We share only what each provider needs to perform its function. Our current
sub-processors are:

| Provider | Purpose | Data shared |
| --- | --- | --- |
| **Shopify Inc.** | App platform, authentication, file storage, billing | Store and merchant identifiers, uploaded files, subscription records |
| **MongoDB, Inc. (Atlas)** | Database hosting | All App data described in Section 2 |
| **Our hosting provider** | Running the App's servers | All App data described in Section 2 |
| **SwipeOne** | Customer relationship management and merchant lifecycle messaging | Shop domain, store owner name, email, phone, address, country, store creation date, Shopify plan name, and lifecycle events — install, uninstall, first visit to the pricing page, and subscription status changes |
| **bPlugins support ticket system** (operated by us) | Handling support requests | Name, email, subject and message from the in-app support form, plus shop domain and whether the store is on a paid plan |
| **Google LLC (Google Analytics 4)** | Product usage analytics in the admin | Page views, device and browser data, IP-derived approximate location, shop domain, analytics cookie identifier |
| **Microsoft Corporation (Clarity)** | Session replay and heatmaps in the admin | Interaction recordings within the App's admin pages, device and browser data, IP-derived approximate location |

We may also disclose information where required by law, court order, or a valid
governmental request, or to establish, exercise, or defend legal claims.

If bPlugins is involved in a merger, acquisition, or sale of assets, merchant data may
be transferred as part of that transaction. We will notify affected merchants before
their data becomes subject to a different privacy policy.

---

## 7. How long we keep data

| Data | Retention |
| --- | --- |
| Session and access token | Deleted as soon as we receive the uninstall webhook |
| Model references, viewer configuration, plan and subscription records, onboarding state | Erased when Shopify sends the `shop/redact` webhook, **48 hours after uninstall** |
| Uploaded model files | Remain in the merchant's own Shopify Files library and are under the merchant's control; uninstalling the App does not delete them from Shopify |
| Metafields written into the merchant's store | Part of the merchant's own store data. Shopify removes the App's reserved-namespace metafields when the App is uninstalled; any in the `custom` namespace stay until the merchant deletes them |
| Server logs | Up to **90 days** |
| Analytics data | Per the provider's retention settings — Google Analytics up to **14 months**, Microsoft Clarity up to **30 days** |
| CRM records in SwipeOne | Until deletion is requested, or the record becomes inactive under our retention schedule |
| Support tickets | Retained while the enquiry is open and for a reasonable period afterwards, so that follow-up questions have context |
| Payout and tax records received from Shopify | For as long as tax and accounting law requires, typically **7 years** |

We do not hold your payment records. Shopify processes every charge and retains its own
billing records under Shopify's privacy policy; what we receive from Shopify are payout
and tax documents identifying the store, not the payment instrument.

### What happens when a merchant uninstalls

Shopify sends us an `app/uninstalled` webhook. On receipt we delete the store's session
records and access token, which ends our ability to reach the store at all. Shopify
then sends `shop/redact` 48 hours later, and on that signal we erase the store's
remaining App data. We honour all three of Shopify's mandatory data privacy webhooks:

- **`customers/data_request`** — a request for a customer's stored data. The App stores
  no customer data, so we confirm this to the merchant.
- **`customers/redact`** — a request to erase a customer's data. The App stores no
  customer data; no erasure is needed.
- **`shop/redact`** — sent 48 hours after uninstall. We erase the store's sessions,
  model records, subscription records, account record, and setup state.

Every webhook we accept is verified by HMAC signature; a request that fails
verification is rejected.

---

## 8. Your rights and choices

### For merchants

Depending on where you live, you may have the right to:

- **Access** the personal information we hold about you.
- **Correct** information that is inaccurate or incomplete.
- **Delete** your personal information.
- **Port** your data to another provider in a structured, machine-readable format.
- **Restrict or object to** certain processing, including direct marketing.
- **Withdraw consent** where processing is based on consent.
- **Lodge a complaint** with your local data protection authority.

To exercise any of these rights, email **privacy@bplugins.com**. We respond within
**30 days**. We may need to verify your identity and your association with the store
before acting.

You can also delete most App data yourself: uninstalling the App from your Shopify
admin triggers the deletion process described in Section 7.

### Opting out of analytics

- **Google Analytics** — install the
  [Google Analytics Opt-out Browser Add-on](https://tools.google.com/dlpage/gaoptout).
- **Microsoft Clarity** — see the
  [Microsoft privacy statement](https://privacy.microsoft.com/privacystatement).
- Browser-level cookie blocking or a Do Not Track / Global Privacy Control signal will
  also prevent these scripts from associating activity with you.

### For store visitors

The App does not collect personal information from store visitors beyond the server
log data described in Section 2.7. If you are a store visitor with a privacy question,
contact the merchant whose store you visited; they can raise it with us on your behalf,
or you can email us directly at **privacy@bplugins.com**.

### California residents (CCPA/CPRA)

We do not sell or share personal information as those terms are defined by the CCPA,
and we have not done so in the preceding 12 months. California residents may request
disclosure of the categories and specific pieces of personal information we have
collected, request deletion, and are entitled not to be discriminated against for
exercising these rights. Submit requests to **privacy@bplugins.com**.

---

## 9. Cookies

Within the Shopify admin, the App uses:

- **Strictly necessary cookies** — session and authentication cookies set by Shopify
  and by the App. The App cannot function without them.
- **Analytics cookies** — set by Google Analytics and Microsoft Clarity, as described
  in Section 2.6.

The storefront viewer embed does not set cookies of its own.

---

## 10. Security

We protect data with measures appropriate to its sensitivity, including encryption in
transit over HTTPS, access controls limiting staff access to production data, HMAC
verification of every Shopify webhook, and secure handling of access tokens. No method
of transmission or storage is completely secure, so we cannot guarantee absolute
security. If a breach affects your personal data, we will notify you and the relevant
supervisory authority as required by law.

**One thing worth knowing about share links.** Every model in the App has a shareable
viewer link. That link is public by design: anyone who has it can view that 3D model
without signing in, in the same way that anyone with the URL of an image on your store
can open it. The links contain a random identifier that cannot be guessed or stepped
through to find other models, but treat a share link as public once you have sent it.
A model you no longer want reachable should be deleted from the App.

---

## 11. Children's privacy

The App is a business tool intended for merchants and is not directed at children under
16. We do not knowingly collect personal information from children. If you believe a
child has provided us with personal information, contact us and we will delete it.

---

## 12. Changes to this policy

We may update this policy to reflect changes to the App, to our providers, or to legal
requirements. The "Last updated" date at the top will change, and material changes will
be announced within the App or by email to the store's contact address. Continued use
of the App after an update means you accept the revised policy.

---

## 13. Contact us

**bPlugins LLC**
Privacy enquiries: **privacy@bplugins.com**
Support: **support@bplugins.com**
Website: <https://bplugins.com>
Postal address: _[add registered business address]_

For merchants in the EEA or the UK, bPlugins LLC acts as a **data processor** for the
personal data contained in your store, and as a **data controller** for the merchant
account and usage data described in Sections 2.1, 2.4, 2.5, and 2.6. We do not have an
EU or UK representative appointed under Article 27 at this time.

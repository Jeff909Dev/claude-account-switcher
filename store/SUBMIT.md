# Submitting to the Chrome Web Store

Step by step, for the Google account that will own the listing. All the text to paste is in `store/listing.md`.
Google renames buttons now and then: if a label below doesn't match exactly, look for the closest one on the same
page.

## 0. Before you start

1. **Privacy policy online.** Deploy `site/` to Vercel the way the landing page is deployed, then open
   <https://claude-account-switcher.vercel.app/privacy.html> and check that it loads. The review checks this URL.
2. **Build the package** from a clean checkout of the branch you're releasing:

   ```bash
   pnpm install
   pnpm test && pnpm typecheck
   pnpm zip            # → claude-account-switcher.zip, manifest.json at its root, version 0.2.0
   ```

3. **Turn on 2-Step Verification** on the Google account (required to publish): <https://myaccount.google.com>
   → **Security** → **2-Step Verification** → **Turn on**, and follow the steps.

## 1. Register as a Chrome Web Store developer (once)

1. Open <https://chrome.google.com/webstore/devconsole> and sign in with that Google account.
2. Accept the **developer agreement** and policies.
3. Pay the **one-time US$5 registration fee** (card payment through Google).
4. Go to **Account** (left menu):
   - **Publisher name**: the name shown on the listing (your name or `Jeff909Dev`; never "Claude" or "Anthropic").
   - **Contact email**: enter it, then click the link in the verification email. Publishing is blocked until it is
     verified. This email is stored in the dashboard only; keep it out of the repo.
   - **Trader / non-trader declaration** (EU Digital Services Act): pick **non-trader** for a free personal
     project. If you publish it as a business, pick trader: your address and contact details are then shown on
     the listing.
   - Click **Save changes**.

## 2. Create the item

1. **Items** → **+ New item** (top right).
2. **Choose file** → `claude-account-switcher.zip` → **Upload**. The draft opens; the name, summary and version
   come from the manifest.

## 3. Store listing tab

1. **Description**: paste the description from `listing.md`.
2. **Category**: Productivity (sub-category **Tools**, if asked). **Language**: English.
3. **Graphic assets**:
   - **Store icon**: upload `store/icon-128.png`.
   - **Screenshots**: upload `store/screenshots/1-switch-accounts.png`, `2-in-page-switcher.png`,
     `3-open-as.png`, `4-manage-and-privacy.png`, in that order.
   - **Small promo tile**: upload `store/promo-440x280.png`. Leave the marquee tile and video empty.
4. **Additional fields**: Homepage URL `https://claude-account-switcher.vercel.app`, Support URL
   `https://github.com/Jeff909Dev/claude-account-switcher/issues`; leave Official URL as none; Mature content: no.
5. **Save draft** (top right).

## 4. Privacy tab

1. **Single purpose description**: paste from `listing.md`.
2. **Permission justification**: one box each for `cookies`, `storage`, `alarms`, `webRequest` and the host
   permission (`https://claude.ai/*`); paste the matching text from `listing.md`. If the dashboard lists a
   permission that isn't among these, stop: the zip isn't the 0.2.0 build.
3. **Are you using remote code?** → **No, I am not using remote code**.
4. **Data usage**: tick exactly the categories marked **Yes** in the table in `listing.md` (Personally identifiable
   information, Authentication information, Web history, User activity), then tick the three certifications.
5. **Privacy policy URL**: `https://claude-account-switcher.vercel.app/privacy.html`.
6. **Save draft**.

## 5. Distribution tab

1. **Payments**: free of charge.
2. **Visibility**: **Public** (anyone can find it), or **Unlisted** (only people with the link; it can be made
   Public later).
3. **Distribution / regions**: all regions.
4. **Save draft**.

## 6. Test instructions tab

If the dashboard has a **Test instructions** tab, paste the reviewer notes from `listing.md`. Only add login details
for throwaway claude.ai accounts made for the review, never your own.

## 7. Submit

1. Click **Submit for review** (top right). If the button is greyed out, the dashboard lists what's missing.
2. In the dialog, keep **Publish automatically after the review** ticked to go live as soon as it's approved, or
   untick it to publish by hand from the dashboard once approved.
3. Click **Submit**. The item's status changes to **Pending review**.

## 8. Review

- Most reviews take a few days. A first submission from a new developer, and an extension that asks for `cookies`
  and `webRequest` on a login site, can get a longer manual review, sometimes a few weeks.
- The outcome arrives by email to the contact address and shows on the item's status. A rejection names the
  policy (for example excessive permissions, or missing privacy information): fix that, upload again if the code
  changed, and click **Submit for review** again.
- Once it's live, the listing link is `https://chromewebstore.google.com/detail/<item id>`; add it to the
  landing page and the README.

## 9. Publishing an update

1. Bump the version in `src/manifest.json` **and** `package.json` (same number, higher than the published one;
   the build test checks that they match).
2. `pnpm test && pnpm typecheck && pnpm zip`.
3. Dashboard → the item → **Package** → **Upload new package** → `claude-account-switcher.zip`.
4. If permissions, data use or features changed, update the Store listing and Privacy tabs (and
   `store/listing.md`, `site/privacy.html`). A new permission disables the extension for existing users until
   they accept it, so avoid adding one casually.
5. **Submit for review**. Users get the update automatically after approval.

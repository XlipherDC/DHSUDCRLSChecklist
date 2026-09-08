# Set up shared records with Cloudflare

The checklist can keep its interface on GitHub Pages while Cloudflare stores the records. A Worker provides the small API and a D1 database stores every project, checklist decision, fee assessment, and payment entry.

## 1. Create the free Cloudflare account

Create an account at [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up). You do not need to buy or transfer a domain. Confirm your email address, then leave the Cloudflare dashboard open.

## 2. Publish the checklist on GitHub Pages

The final Pages address will look like `https://owner.github.io/repository/`. If it is not published yet, leave the setup prompt blank. The Worker will initially accept the local development address; rerun the helper after publishing to add the Pages address without deleting records.

## 3. Run the guided setup

From the project folder, run:

```sh
npm install
npm run cloudflare:setup
```

The helper opens Cloudflare authorization, creates the D1 database in the Asia-Pacific region, applies the schema, generates a random 256-bit workspace key, stores it as an encrypted Worker secret, restricts browser requests to the GitHub Pages address, and deploys the Worker.

It prints the **Worker URL** and **workspace key** when finished. It also saves a private copy in `.wrangler/connection.json`. The `.wrangler` folder is ignored by Git. Do not commit the key or paste it into a public issue.

You can safely run the setup command again. It reuses the database and private key, updates the allowed website address, and deploys the current Worker code without deleting records.

To check the deployed connection later without displaying the private key, run `npm run cloudflare:verify`.

## 4. Connect the checklist

1. Open the published checklist.
2. Choose **Shared workspace** in the left navigation.
3. Enter the Worker URL and workspace key from the setup command.
4. Choose **Connect shared workspace**.
5. If this browser already has projects, choose **Copy local projects** once.
6. Choose **Get private link** and send that link only to processors who may view and edit the records.

The key is placed after `#` in the private link. Browsers do not send that fragment to GitHub Pages, and the app removes it from the address after connecting. Because the app has no individual accounts, anyone who receives the link can view, change, or delete shared records.

The app checks for updates every 15 seconds and whenever the tab becomes active. If two processors edit the same project at the same time, the later stale save is rejected and the app reloads the newer record. Changes to separate projects can be merged safely.

**Backup & restore** still exports a portable JSON copy. Disconnecting from the shared workspace returns that browser to its local records and does not delete anything in D1.

Cloudflare references: [D1 documentation](https://developers.cloudflare.com/d1/), [Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/), and [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).

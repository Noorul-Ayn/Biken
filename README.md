# Biken website

The Biken landing page and its ride request form. Requests from the form are saved to the **Biken Ride Requests** Google Sheet, and customers get their emails automatically.

## What's in this project

| File | What it does |
|---|---|
| `index.html`, `styles.css`, `script.js`, `favicon.svg` | The website |
| `api/request.js` | A Vercel function. The form sends each request here, and it passes the request on to Google |
| `apps-script/Code.gs` | Google Apps Script. Saves each request to the sheet and sends the emails |

## How a request travels

1. A customer fills in the form and presses **Send ride request**.
2. The website sends it to `/api/request` on Vercel, which checks it and passes it to the Apps Script.
3. The Apps Script adds a row to the **Requests** tab with Status **New**, emails the customer "We've received your Biken ride request", and emails you a new-request alert.
4. A coordinator finds a rider in Biken Dispatch, fills in **Rider** and **Fare (RWF)** on the row, and sets Status to **Confirmed**. The customer is then emailed their ride details automatically.

## One-time setup

### 1. Connect the Google Sheet (about 5 minutes)

Do this step signed in as **h.bello@alustudent.com**. Biken's emails are sent from whichever Google account sets up the script, so customers will see them come from that address.

1. Open the [Biken Ride Requests](https://docs.google.com/spreadsheets/d/1WuuiJXybo2EIIGlIsT28IaEougBVbSeD00dnfKpSZLI/edit) sheet.
2. Go to **Extensions > Apps Script**.
3. Delete the code in the editor, paste in everything from `apps-script/Code.gs`, and click **Save**.
4. In the function menu at the top, choose **setup** and click **Run**. Google asks for permission:
   - Click **Review permissions** and choose your account.
   - Google warns that it "hasn't verified this app". That's expected for your own script: click **Advanced**, then **Go to (project name)**, then **Allow**.
5. The execution log at the bottom shows a long `SHARED_SECRET` value. Copy it; you'll need it in Vercel.
6. Click **Deploy > New deployment**. Click the gear icon and choose **Web app**. Set:
   - **Execute as:** Me
   - **Who has access:** Anyone
7. Click **Deploy** and copy the **Web app URL** (it ends in `/exec`).
8. Optional check: choose **testRequest** in the function menu and click **Run**. A test row appears on the Requests tab and two emails arrive in your inbox. Delete the test row afterwards.

### 2. Put the site on Vercel

1. On [vercel.com](https://vercel.com), click **Add New > Project** and import this GitHub repository.
2. Leave **Framework Preset** as **Other**. There's no build step.
3. Open **Environment Variables** and add two:
   - `APPS_SCRIPT_URL`: the Web app URL from step 1.7
   - `SHARED_SECRET`: the value from step 1.5
4. Click **Deploy**. Open the live site and send yourself a test request.

If you add or change environment variables after the first deploy, redeploy for them to take effect (**Deployments > ... > Redeploy**).

## Day to day

The sheet's **How it works** tab explains the statuses. In short: New, then Finding rider, then Confirmed once Rider and Fare are filled in (this sends the ride details email), then Completed or Cancelled.

To send the ride details again, for example after changing the rider, clear the row's **Ride details emailed** cell.

## Good to know

- Emails are sent from the Google account that set up the script (step 1). Each request emails the customer and both team members, and confirming it sends one more. Google limits how many emails a script can send per day; a school or work Google account usually allows more than a free Gmail account, which allows about 100 recipients a day.
- New-request alerts go to h.bello@alustudent.com and t.oteniya@alustudent.com, and customers' replies go to both of you. To change the addresses, edit `TEAM_EMAILS` near the top of `Code.gs`, or add a script property `NOTIFY_EMAIL` in Apps Script (**Project Settings > Script properties**) to send alerts somewhere else.
- If the Deploy screen doesn't offer **Who has access: Anyone** for your school account, your school has turned that off. Do step 1 from a personal Gmail account instead; emails then come from that account, and replies still go to both of you.
- After changing `Code.gs`, publish the change with **Deploy > Manage deployments**, click the pencil icon, set **Version** to **New version**, and click **Deploy**. The Web app URL stays the same.
- The **Team** link in the footer opens Biken Dispatch on claude.ai. Only people you've given access can open it.

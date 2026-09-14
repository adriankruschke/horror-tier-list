/**
 * OPTIONAL — rebuild the site within ~5 minutes of editing the sheet,
 * instead of waiting for the 2-hourly schedule.
 *
 * Setup (one time):
 *  1. In the Google Sheet: Extensions → Apps Script. Paste this file in.
 *  2. Create a GitHub fine-grained token: github.com/settings/personal-access-tokens
 *     → Only select repository: horror-tier-list → Permissions: Actions = Read and write.
 *  3. Apps Script → Project Settings → Script properties → add
 *       GITHUB_TOKEN = <the token>
 *  4. Run `installTrigger` once from the editor and approve the permissions prompt.
 */

const REPO = 'adriankruschke/horror-tier-list';
const WORKFLOW = 'deploy.yml';

function installTrigger() {
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onSheetEdit').forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
  ScriptApp.newTrigger('dispatchIfDirty').timeBased().everyMinutes(5).create();
}

// Edits only mark the sheet dirty, so a burst of edits becomes one rebuild.
function onSheetEdit() {
  PropertiesService.getScriptProperties().setProperty('DIRTY', '1');
}

function dispatchIfDirty() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('DIRTY') !== '1') return;
  const res = UrlFetchApp.fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: `Bearer ${props.getProperty('GITHUB_TOKEN')}`,
      Accept: 'application/vnd.github+json',
    },
    payload: JSON.stringify({ ref: 'main' }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() === 204) props.deleteProperty('DIRTY');
  else console.error(res.getResponseCode(), res.getContentText());
}

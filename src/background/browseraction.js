/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * Portions Copyright (C) Philipp Kewisch, 2017 */

function parseQueueNumbers(doc) {
  let queues = [...doc.querySelectorAll("#main-wrapper .tabnav li a")];
  let countre = /\((\d+)\)/;
  let numbers = {};

  for (let queue of queues) {
    let queueNameParts = queue.getAttribute("href").split("/");
    let queueName = queueNameParts[queueNameParts.length - 1];
    let match = queue.textContent.match(countre);

    if (match) {
      numbers[queueName] = { total: parseInt(match[1], 10) };
    }
  }

  return numbers;
}

async function updateQueueNumbers() {
  let instance = await getStoragePreference("instance");
  let url = `https://${instance}/en-US/reviewers/queue/auto_approved`;
  let text = await fetch(url, { mode: "cors", credentials: "include" }).then(resp => resp.text());
  let parser = new DOMParser();
  let doc = parser.parseFromString(text, "text/html");
  return parseQueueNumbers(doc);
}

async function updateBadge(numbers) {
  let prefs = await getStoragePreference([
    "browseraction-count-legacy",
    "browseraction-count-moderator",
    "browseraction-count-autoapproval",
    "browseraction-count-content"
  ]);

  let total = 0;

  if (prefs["browseraction-count-legacy"]) {
    total += numbers["new"].total + numbers.updates.total;
  }
  if (prefs["browseraction-count-moderator"]) {
    total += numbers.reviews.total;
  }
  if (prefs["browseraction-count-autoapproval"]) {
    total += numbers.auto_approved.total;
  }
  if (prefs["browseraction-count-content"]) {
    total += numbers.content_review.total;
  }

  browser.browserAction.setBadgeText({ text: total.toString() });
}

async function setupQueueRefresh() {
  await browser.alarms.clear("queuelength");
  await browser.alarms.create("queuelength", {
    delayInMinutes: 0,
    periodInMinutes: await getStoragePreference("browseraction-queue-refresh-period")
  });
}

async function closeAMOTabs() {
  let urls = AMO_EDITORS_PATTERNS.concat(AMO_PRIVACY_PAGES).concat(FILEBROWSER_PATTERNS);
  let results = await browser.tabs.query({ url: urls });

  let tabIds = [].concat(...results).map(tab => tab.id);
  await browser.tabs.remove(tabIds);
}

async function switchToReviewPage(type="listed") {
  let [tab, ...rest] = await browser.tabs.query({ active: true, currentWindow: true });
  let match = tab.url.match(ADDON_LINKS_RE);
  if (match) {
    await browser.tabs.update(tab.id, {
      url: replacePattern(REVIEW_URL, {
        type: "-" + type,
        addon: match[5],
        instance: match[1]
      })
    });
  }
}

async function showUserAddons() {
  let [tab, ...rest] = await browser.tabs.query({ active: true, currentWindow: true });
  let userId = tab.url.split("/").pop();
  let url = "https://sql.telemetry.mozilla.org/queries/49910?p_user=" + userId;
  browser.tabs.update(tab.id, { url });
}

// -- main --

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name == "queuelength") {
    updateQueueNumbers().then(updateBadge);
  }
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area != "local") {
    return;
  }

  for (let key of Object.keys(changes)) {
    if (key == "browseraction-queue-refresh-period") {
      setupQueueRefresh();
    } else if (key == "instance") {
      updateQueueNumbers().then(updateBadge);
    } else if (key.startsWith("browseraction-count-")) {
      updateQueueNumbers().then(updateBadge);
    }
  }
});

browser.runtime.onMessage.addListener((data, sender) => {
  if (data.action == "popup-action-refreshcount") {
    updateQueueNumbers().then(updateBadge);
  } else if (data.action == "popup-action-closetabs") {
    closeAMOTabs();
  } else if (data.action == "popup-action-gototechnical") {
    switchToReviewPage("listed");
  } else if (data.action == "popup-action-gotocontent") {
    switchToReviewPage("content");
  } else if (data.action == "popup-action-showuseraddons") {
    showUserAddons();
  } else if (data.action == "update-badge-numbers") {
    updateBadge(data.numbers);
  }
});

setupQueueRefresh();
updateQueueNumbers().then(updateBadge);

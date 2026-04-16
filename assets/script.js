
const criteria = [
  { id: 'overallOrganization', label: 'Overall organization (1 – 20)', max: 20 },
  { id: 'preparedness', label: 'Preparedness (1 – 15)', max: 15 },
  { id: 'visualAids', label: 'Visual aids quality/effect (1 – 15)', max: 15 },
  { id: 'technicalContent', label: 'Technical content (1 – 15)', max: 15 },
  { id: 'delivery', label: 'Delivery (1 – 15)', max: 15 },
  { id: 'handlingQuestions', label: 'Handling of questions (1 – 10)', max: 10 },
  { id: 'effectiveTime', label: 'Effective use of time (1 – 10)', max: 10 }
];

let allRatesCache = [];
let allRatesCacheTime = 0;
let allRatesRequestPromise = null;
const ALL_RATES_CACHE_TTL = 30000;

// --- DYNAMIC TITLE DROPDOWN GENERATION ---
function buildTitleDropdown() {
  const titleSelect = document.getElementById("title");
  projectTitles.forEach(title => {
    const option = document.createElement("option");
    option.value = title;
    option.textContent = title;
    titleSelect.appendChild(option);
  });
}

// --- DYNAMIC TABLE GENERATION ---
function buildEvaluationTable() {
  let theadHtml = `<tr><th style="width: 24%;">Items Evaluated</th>`;
  groupMembers.forEach(member => {
    theadHtml += `<th>${escapeHtml(member)}</th>`;
  });
  theadHtml += `</tr>`;
  document.getElementById('evalThead').innerHTML = theadHtml;

  let tbodyHtml = `<tr><td class="left"><strong>Member Names</strong></td>`;
  groupMembers.forEach(member => {
    tbodyHtml += `<td class="member-name">${escapeHtml(member)}</td>`;
  });
  tbodyHtml += `</tr>`;

  criteria.forEach(crit => {
    tbodyHtml += `<tr><td class="left">${crit.label}</td>`;
    groupMembers.forEach((_, index) => {
      let num = index + 1;
      tbodyHtml += `<td><input id="${crit.id}${num}" type="number" min="1" max="${crit.max}" required oninput="handleScoreInput(this)" /></td>`;
    });
    tbodyHtml += `</tr>`;
  });

  tbodyHtml += `<tr><td class="left"><strong>Total Individual Score</strong></td>`;
  groupMembers.forEach((_, index) => {
    tbodyHtml += `<td id="totalMember${index + 1}">0</td>`;
  });
  tbodyHtml += `</tr>`;

  tbodyHtml += `<tr><td class="left"><strong>Overall Group Score</strong></td><td colspan="${groupMembers.length}" id="overallGroupScore">0</td></tr>`;
  document.getElementById('evalTbody').innerHTML = tbodyHtml;
}

// --- UTILITIES ---
function formatCurrentTime() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true });
}
function formatCurrentDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
function autoFillDateTime() {
  document.getElementById("time").value = formatCurrentTime();
  document.getElementById("date").value = formatCurrentDate();
}
function clampNumberInput(input) {
  if (!input || input.value === "") return;
  let value = Number(input.value);
  const min = input.min !== "" ? Number(input.min) : null;
  const max = input.max !== "" ? Number(input.max) : null;
  if (Number.isNaN(value)) { input.value = ""; return; }
  if (min !== null && value < min) value = min;
  if (max !== null && value > max) value = max;
  input.value = value;
}
function handleScoreInput(input) {
  clampNumberInput(input);
  updateTotals();
}
function num(id) {
  return Number(document.getElementById(id).value || 0);
}
function memberTotal(index) {
  return criteria.reduce((sum, crit) => sum + num(`${crit.id}${index}`), 0);
}
function updateTotals() {
  let grandTotal = 0;

  for (let i = 1; i <= groupMembers.length; i++) {
    const total = memberTotal(i);
    document.getElementById(`totalMember${i}`).textContent = total;
    grandTotal += total;
  }
  document.getElementById("overallGroupScore").textContent = grandTotal;
}

// --- PAYLOAD BUILDERS ---
function getGroupMembersJson() {
  let membersObj = {};
  groupMembers.forEach((member, idx) => {
    membersObj[`member${idx + 1}`] = member;
  });
  return JSON.stringify(membersObj);
}

function getScoresJson() {
  let scoresObj = {};
  criteria.forEach(crit => {
    scoresObj[crit.id] = {};
    groupMembers.forEach((_, idx) => {
      scoresObj[crit.id][`member${idx + 1}`] = num(`${crit.id}${idx + 1}`);
    });
  });
  scoresObj.totalIndividualScore = {};
  groupMembers.forEach((_, idx) => {
    scoresObj.totalIndividualScore[`member${idx + 1}`] = Number(document.getElementById(`totalMember${idx + 1}`).textContent || 0);
  });
  return JSON.stringify(scoresObj);
}

function getFormPayload() {
  return {
    evaluator: document.getElementById("evaluator").value.trim(),
    time: document.getElementById("time").value.trim(),
    date: document.getElementById("date").value,
    signature: document.getElementById("signature").value.trim(),
    title: document.getElementById("title").value.trim(),
    groupMembersJson: getGroupMembersJson(),
    scoresJson: getScoresJson(),
    overallGroupScore: Number(document.getElementById("overallGroupScore").textContent || 0),
    generalComments: document.getElementById("generalComments").value.trim(),
    createdAt: new Date().toISOString()
  };
}

function validateForm() {
  const missingFields = [];
  if (!document.getElementById("evaluator").value.trim()) missingFields.push("Evaluator");
  if (!document.getElementById("time").value.trim()) missingFields.push("Time");
  if (!document.getElementById("date").value.trim()) missingFields.push("Date");
  if (!document.getElementById("signature").value.trim()) missingFields.push("Signature");
  if (!document.getElementById("title").value.trim()) missingFields.push("Project Title");
  if (!document.getElementById("generalComments").value.trim()) missingFields.push("General Comments");

  criteria.forEach(crit => {
    for (let i = 1; i <= groupMembers.length; i++) {
      if (!document.getElementById(`${crit.id}${i}`).value.trim()) {
        missingFields.push(`${crit.id}${i}`);
      }
    }
  });
  return { valid: missingFields.length === 0, missingFields };
}

// --- API & DATA HANDLING ---
async function fetchWithTimeout(url, options = {}, timeout = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try { return await fetch(url, { ...options, signal: controller.signal, cache: "no-store" }); } 
  finally { clearTimeout(timer); }
}

async function sendDataToGoogleSheet(payload) {
  const body = JSON.stringify(payload);
  if (navigator.sendBeacon) {
    const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
    if (navigator.sendBeacon(GOOGLE_SCRIPT_WEB_APP_URL, blob)) return true;
  }
  await fetch(GOOGLE_SCRIPT_WEB_APP_URL, {
    method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=utf-8" }, body
  });
  return true;
}

async function submitToGoogleSheet() {
  const status = document.getElementById("status");
  const saveButton = document.querySelector('button[onclick="submitToGoogleSheet()"]');
  const validation = validateForm();

  if (!validation.valid) {
    status.style.color = "red";
    status.textContent = "Cannot save. Missing input(s): " + validation.missingFields.join(", ");
    return;
  }

  const payload = getFormPayload();
  status.style.color = "black";
  status.textContent = "Saving Data...";
  if (saveButton) saveButton.disabled = true;

  try {
    await sendDataToGoogleSheet(payload);
    status.style.color = "green";
    status.textContent = "Data submitted successfully. Please check your Google Sheet.";
    allRatesCache = [];
    allRatesCacheTime = 0;
    setTimeout(() => {
      clearForm();
      status.style.color = "green";
      status.textContent = "Saved successfully.";
    }, 800);
  } catch (error) {
    status.style.color = "red";
    status.textContent = "Failed to save data: " + error.message;
  } finally {
    if (saveButton) saveButton.disabled = false;
  }
}

// --- VIEW ALL RATES ---
async function fetchAllRates(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && allRatesCache.length && (now - allRatesCacheTime < ALL_RATES_CACHE_TTL)) return allRatesCache;
  if (!forceRefresh && allRatesRequestPromise) return allRatesRequestPromise;

  allRatesRequestPromise = (async () => {
    const response = await fetchWithTimeout(`${GOOGLE_SCRIPT_WEB_APP_URL}?action=getAllRates`, { method: "GET", mode: "cors" }, 15000);
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.message || "Unable to load rates.");
    allRatesCache = Array.isArray(result.data) ? result.data : [];
    allRatesCacheTime = Date.now();
    return allRatesCache;
  })();

  try { return await allRatesRequestPromise; } 
  finally { allRatesRequestPromise = null; }
}

async function loadAllRates(forceRefresh = false) {
  const status = document.getElementById("status");
  const tbody = document.getElementById("ratesTableBody");
  status.style.color = "black";
  status.textContent = "Loading all rates...";
  tbody.innerHTML = '<tr><td colspan="9" class="center">Loading...</td></tr>';
  try {
    const rows = await fetchAllRates(forceRefresh);
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="center">No saved evaluations found.</td></tr>';
      status.textContent = "No saved evaluations found.";
      return;
    }
    tbody.innerHTML = rows.map((row, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(row.evaluator)}</td>
        <td>${escapeHtml(row.time)}</td>
        <td>${escapeHtml(row.date)}</td>
        <td>${escapeHtml(row.signature)}</td>
        <td class="wrap">${escapeHtml(row.title)}</td>
        <td>${escapeHtml(row.overallGroupScore)}</td>
        <td>${escapeHtml(row.createdAt)}</td>
        <td><button type="button" onclick="viewDetails(${index})">View</button></td>
      </tr>`).join("");
    status.style.color = "green";
    status.textContent = `Loaded ${rows.length} saved evaluation(s).`;
  } catch (error) {
    tbody.innerHTML = `<tr><td colspan="9" class="center">${escapeHtml(error.message)}</td></tr>`;
    status.style.color = "red";
    status.textContent = `Error: ${error.name === "AbortError" ? "Request timeout." : error.message}`;
  }
}

// --- DETAILS PAGE ---
function buildDetailsTable(row) {
  const scores = parseSafeJson(row.scoresJson, {});
  const members = parseSafeJson(row.groupMembersJson, {});
  const memKeys = Object.keys(members).filter(k => k.startsWith('member'));

  let theadHtml = `<tr><th style="width: 24%;">Items Evaluated</th>`;
  memKeys.forEach(key => { theadHtml += `<th>${escapeHtml(members[key])}</th>`; });
  theadHtml += `</tr>`;
  document.getElementById('detailsThead').innerHTML = theadHtml;

  let tbodyHtml = `<tr><td class="left"><strong>Member Names</strong></td>`;
  memKeys.forEach(key => { tbodyHtml += `<td class="member-name">${escapeHtml(members[key])}</td>`; });
  tbodyHtml += `</tr>`;

  criteria.forEach(crit => {
    let sc = scores[crit.id] || {};
    tbodyHtml += `<tr><td class="left">${crit.label}</td>`;
    memKeys.forEach(key => { tbodyHtml += `<td>${escapeHtml(sc[key] ?? "")}</td>`; });
    tbodyHtml += `</tr>`;
  });

  let totals = scores.totalIndividualScore || {};
  tbodyHtml += `<tr><td class="left"><strong>Total Individual Score</strong></td>`;
  memKeys.forEach(key => { tbodyHtml += `<td>${escapeHtml(totals[key] ?? "")}</td>`; });
  tbodyHtml += `</tr>`;

  tbodyHtml += `<tr><td class="left"><strong>Overall Group Score</strong></td><td colspan="${memKeys.length}">${escapeHtml(row.overallGroupScore)}</td></tr>`;
  document.getElementById("detailsScoresBody").innerHTML = tbodyHtml;
}

function fillDetailsPage(row) {
  document.getElementById("detailEvaluator").textContent = row.evaluator || "";
  document.getElementById("detailTime").textContent = row.time || "";
  document.getElementById("detailDate").textContent = row.date || "";
  document.getElementById("detailSignature").textContent = row.signature || "";
  document.getElementById("detailTitle").textContent = row.title || "";
  document.getElementById("detailGeneralComments").textContent = row.generalComments || "";
  buildDetailsTable(row);
}

async function viewDetails(index) {
  const status = document.getElementById("status");
  status.style.color = "black";
  status.textContent = "Loading evaluation details...";
  try {
    let rows = allRatesCache.length ? allRatesCache : await fetchAllRates(false);
    const row = rows[index];
    if (!row) throw new Error("Evaluation details not found.");
    fillDetailsPage(row);
    showDetailsPage();
    status.style.color = "green";
    status.textContent = `Viewing saved evaluation #${index + 1}.`;
  } catch (error) {
    status.style.color = "red";
    status.textContent = `Error: ${error.name === "AbortError" ? "Request timeout." : error.message}`;
  }
}

// --- HELPER FUNCTIONS ---
function parseSafeJson(value, fallback = {}) {
  try { return value ? (typeof value === "string" ? JSON.parse(value) : value) : fallback; } 
  catch (error) { return fallback; }
}
function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function clearForm() {
  document.getElementById("evaluator").value = "";
  document.getElementById("signature").value = "";
  document.getElementById("title").value = "";
  document.getElementById("generalComments").value = "";
  document.getElementById("status").textContent = "";
  criteria.forEach(crit => {
    for (let i = 1; i <= groupMembers.length; i++) {
      let el = document.getElementById(`${crit.id}${i}`);
      if (el) el.value = "";
    }
  });
  autoFillDateTime();
  updateTotals();
}
function fillSample() {
  document.getElementById("evaluator").value = "Dr. Juan Dela Cruz";
  document.getElementById("signature").value = "Signed";
  // Kuhaon ang pinakaunang title as sample kung naay sulod ang array
  if(typeof projectTitles !== 'undefined' && projectTitles.length > 0) {
    document.getElementById("title").value = projectTitles[0];
  }
  document.getElementById("generalComments").value = "Good presentation with clear organization.";
  autoFillDateTime();

  const sampleValues = [14, 13, 14, 15, 13, 14, 15, 12, 11, 10];
  criteria.forEach(crit => {
    for (let i = 1; i <= groupMembers.length; i++) {
      let input = document.getElementById(`${crit.id}${i}`);
      if (input) {
        let val = sampleValues[(i + crit.max) % sampleValues.length];
        input.value = val > crit.max ? crit.max : val;
        clampNumberInput(input);
      }
    }
  });
  updateTotals();
}

function showFormPage() {
  document.getElementById("formPage").classList.remove("hidden");
  document.getElementById("formToolbar").classList.remove("hidden");
  document.getElementById("ratesPage").classList.add("hidden");
  document.getElementById("ratesToolbar").classList.add("hidden");
  document.getElementById("detailsPage").classList.add("hidden");
  document.getElementById("detailsToolbar").classList.add("hidden");
}
function showRatesPage() {
  document.getElementById("formPage").classList.add("hidden");
  document.getElementById("formToolbar").classList.add("hidden");
  document.getElementById("ratesPage").classList.remove("hidden");
  document.getElementById("ratesToolbar").classList.remove("hidden");
  document.getElementById("detailsPage").classList.add("hidden");
  document.getElementById("detailsToolbar").classList.add("hidden");
}
function showDetailsPage() {
  document.getElementById("formPage").classList.add("hidden");
  document.getElementById("formToolbar").classList.add("hidden");
  document.getElementById("ratesPage").classList.add("hidden");
  document.getElementById("ratesToolbar").classList.add("hidden");
  document.getElementById("detailsPage").classList.remove("hidden");
  document.getElementById("detailsToolbar").classList.remove("hidden");
}
function goToViewAllRates() { showRatesPage(); loadAllRates(); }
function goToFormPage() { showFormPage(); }

// --- INITIALIZE ---
buildTitleDropdown(); // Tawagon ang function para mag-load ang mga titles
buildEvaluationTable();
autoFillDateTime();
updateTotals();
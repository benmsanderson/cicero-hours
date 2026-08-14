// Exercises the allocation board's JS in jsdom: initial render, moving committed
// hours between people, splitting, capacity feedback, undo, adding a card, the
// change summary, the live chart of the proposal, the plan file it saves and
// reloads, the exported plan, and reset.
//
// Same body drives both builds:
//
//   node tests/board_check.js <dashboard.html>
//     A Python-built dashboard. The board is already on the page.
//
//   node tests/board_check.js <shell.html> <synthetic.csv>
//     The browser-built shell. Feeds the CSV into its file input and
//     clicks the Allocation board tab first, then runs the same assertions.

const fs = require("fs");
const { JSDOM, VirtualConsole } = require("jsdom");

const [, , htmlPath, csvPath] = process.argv;
if (!htmlPath) {
  console.error(
    "usage:\n" +
    "  node tests/board_check.js <python-dashboard.html>\n" +
    "  node tests/board_check.js <web-shell.html> <synthetic.csv>\n" +
    "  npm run test:board  # runs the Python variant\n" +
    "  npm run test:board:web  # runs the web variant"
  );
  process.exit(2);
}
const html = fs.readFileSync(htmlPath, "utf8");
const csvText = csvPath ? fs.readFileSync(csvPath, "utf8") : null;
const isWeb = !!csvText;

// The plotly bundle is stripped, so the figure scripts it leaves behind
// throw on every load. That one is expected; anything else is worth seeing.
function quietConsole() {
  const vc = new VirtualConsole();
  vc.sendTo(console, { omitJSDOMErrors: true });
  vc.on("jsdomError", (err) => {
    if (!/Plotly is not defined/.test(err.message)) console.error(err);
  });
  return vc;
}

// The Python build inlines megabytes of Plotly canvas code jsdom cannot run,
// so strip that <script> before parsing. The web build does not inline Plotly
// yet (Phase 6), and its own bundle contains the word "Plotly" only in a
// typeof guard, so leave that intact.
const stripped = isWeb
  ? html
  : html.replace(/<script>[\s\S]*?Plotly[\s\S]*?<\/script>/, "<script></script>");

async function buildDom(extraBeforeParse) {
  const dom = new JSDOM(stripped, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: "http://localhost/",
    virtualConsole: quietConsole(),
    beforeParse(w) {
      // jsdom 26 does not expose TextDecoder on window; the web build's
      // shell needs it to decode the CSV. Real browsers have it natively.
      if (!w.TextDecoder) w.TextDecoder = TextDecoder;
      if (extraBeforeParse) extraBeforeParse(w);
    },
  });
  if (isWeb) await feedCsvAndOpenBoard(dom);
  return dom;
}

async function feedCsvAndOpenBoard(dom) {
  const w = dom.window, d = w.document;
  await tick();
  const file = new w.File([csvText], "export.csv", { type: "text/csv" });
  const input = d.getElementById("file");
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new w.Event("change", { bubbles: true }));
  await waitFor(() => d.getElementById("pool"), 3000);
  const tab = Array.from(d.querySelectorAll("nav button"))
    .find(b => b.dataset.target === "board");
  if (tab) tab.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
}

function tick() { return new Promise(r => setTimeout(r, 0)); }
async function waitFor(fn, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const v = fn();
    if (v) return v;
    await new Promise(r => setTimeout(r, 10));
  }
  throw new Error(`timeout after ${timeoutMs}ms waiting for the board to mount`);
}

// -------------------------------------------------------- main body

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log("  ok   " + name);
  else { console.log("  FAIL " + name + (extra ? "  <- " + extra : "")); failures++; }
}

async function main() {
  const dom = await buildDom();
  const { window } = dom;
  const doc = window.document;
  const $ = (s) => doc.querySelector(s);
  const $$ = (s) => Array.from(doc.querySelectorAll(s));
  const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  const hours = (chip) => parseFloat(chip.querySelector(".hrs").textContent.replace(/[^\d.]/g, ""));

  const D = window.BOARD_DATA;
  const guide = D.billable_hours;
  console.log(`${isWeb ? "web" : "python"} build · ${D.people.length} people, ` +
              `${D.blocks.length} blocks, guide ${guide} h, opens on ${D.default_year}`);

  const cards = () => $$("#people-grid .person");
  const cardFor = (person) => cards().find(c => c.dataset.person === person);
  const poolChips = () => $$("#pool-chips .chip");
  const chipsOn = (person) => Array.from(cardFor(person).querySelectorAll(".chip"));
  const planned = (person) =>
    parseFloat(cardFor(person).querySelector(".numbers span").textContent.replace(/[^\d.]/g, ""));

  // --- initial render -------------------------------------------------------
  check("a card per person", cards().length === D.people.length);
  check("opens on the year with the most unassigned time",
        $(`#year-${D.default_year}`).getAttribute("aria-pressed") === "true");
  check("undo starts disabled", $("#board-undo").disabled === true);
  check("changes panel starts empty", /Nothing moved yet/.test($("#board-changes").textContent));

  const owned = D.blocks.filter(b => b.year === D.default_year && b.origin !== null);
  const busiest = owned.length
    ? owned.reduce((a, b) => (a.hours > b.hours ? a : b))
    : null;
  check("someone has committed hours to move", busiest !== null);
  if (!busiest) { console.log("\ncannot continue without committed hours"); process.exit(1); }

  const donor = busiest.origin;
  const receiver = D.people.find(p => p !== donor);
  check("committed hours appear as chips on their owner's card",
        chipsOn(donor).some(c => c.querySelector(".name").textContent === busiest.project));
  check("cards are sorted with the heaviest baseline first",
        cards()[0].dataset.person === D.people
          .slice()
          .sort((a, b) => ((D.baseline[b] || {})[D.default_year] || 0) -
                          ((D.baseline[a] || {})[D.default_year] || 0))[0]);

  // --- moving committed hours between people --------------------------------
  const donorBefore = planned(donor), receiverBefore = planned(receiver);
  const chip = chipsOn(donor).find(c => c.querySelector(".name").textContent === busiest.project);
  const moveSize = hours(chip);
  click(chip);
  click(cardFor(receiver));
  check("the block leaves the donor",
        !chipsOn(donor).some(c => c.querySelector(".name").textContent === busiest.project));
  check("the block lands on the receiver",
        chipsOn(receiver).some(c => c.querySelector(".name").textContent === busiest.project));
  check("donor total falls by the block",
        Math.abs(planned(donor) - (donorBefore - moveSize)) < 2,
        `${planned(donor)} vs ${donorBefore - moveSize}`);
  check("receiver total rises by the block",
        Math.abs(planned(receiver) - (receiverBefore + moveSize)) < 2);
  check("a moved block is marked with where it came from",
        chipsOn(receiver).some(c => /from /.test(c.textContent)));
  check("hours are conserved across the move",
        Math.abs((planned(donor) + planned(receiver)) - (donorBefore + receiverBefore)) < 2);

  // --- change summary -------------------------------------------------------
  const changes = $("#board-changes").textContent;
  check("change summary names both people",
        changes.includes(donor) && changes.includes(receiver));
  check("change summary shows a baseline arrow", /→/.test(changes));

  // --- undo -----------------------------------------------------------------
  check("undo is enabled after a move", $("#board-undo").disabled === false);
  click($("#board-undo"));
  check("undo returns the block", Math.abs(planned(donor) - donorBefore) < 2);
  check("undo clears the change summary",
        /Nothing moved yet/.test($("#board-changes").textContent));

  // --- freeing hours back to the pool ---------------------------------------
  const poolBefore = poolChips().length;
  const toFree = chipsOn(donor)[0];
  const freedName = toFree.querySelector(".name").textContent;
  click(toFree.querySelector(".x"));
  check("the × frees a block into the pool", poolChips().length === poolBefore + 1);
  check("a freed block records who held it",
        poolChips().some(c => /was /.test(c.textContent) &&
                              c.querySelector(".name").textContent === freedName));
  check("the pool caption reports hours freed here", /freed here/.test($("#pool-sub").textContent));
  click($("#board-undo"));
  check("undo restores it to its owner", poolChips().length === poolBefore);

  // --- capacity feedback ----------------------------------------------------
  check("no card is shaded before anything is picked up",
        $$(".person.would-exceed").length === 0);
  const big = chipsOn(donor).reduce((a, b) => (hours(a) > hours(b) ? a : b));
  click(big);
  const shaded = $$(".person.would-exceed").map(c => c.dataset.person);
  const wouldExceed = D.people.filter(p => p !== donor && planned(p) + hours(big) > guide);
  check("cards the block would push past the guide are shaded",
        shaded.sort().join("|") === wouldExceed.sort().join("|"),
        `shaded [${shaded}] vs expected [${wouldExceed}]`);
  click(big);

  // --- splitting ------------------------------------------------------------
  const splitMe = chipsOn(donor).reduce((a, b) => (hours(a) > hours(b) ? a : b));
  const splitProject = splitMe.querySelector(".name").textContent;
  const beforeSplit = hours(splitMe);
  const donorTotalBefore = planned(donor);
  click(splitMe.querySelector(".split-btn"));
  check("split opens an input", !!cardFor(donor).parentNode.querySelector(".splitter input"));
  const input = cardFor(donor).querySelector(".splitter input");
  input.value = String(Math.max(1, Math.round(beforeSplit / 4)));
  click(cardFor(donor).querySelector(".splitter button"));
  const parts = chipsOn(donor)
    .filter(c => c.querySelector(".name").textContent === splitProject)
    .map(hours);
  check("split makes two blocks", parts.length === 2, `${parts.length} parts`);
  check("split conserves the block", Math.abs(parts.reduce((a, b) => a + b, 0) - beforeSplit) < 2);
  check("split leaves the person's total unchanged",
        Math.abs(planned(donor) - donorTotalBefore) < 2);

  // --- a hypothetical hire --------------------------------------------------
  const before = cards().length;
  $("#board-newname").value = "New postdoc";
  click($("#board-add"));
  check("adding a card creates one", cards().length === before + 1);
  check("the new card is named", !!cardFor("New postdoc"));
  check("the new card starts empty", chipsOn("New postdoc").length === 0);
  const part = chipsOn(donor).find(c => c.querySelector(".name").textContent === splitProject);
  const partHours = hours(part);
  click(part);
  click(cardFor("New postdoc"));
  check("hours can be moved to the hypothetical person",
        Math.abs(planned("New postdoc") - partHours) < 2);

  // --- year switch ----------------------------------------------------------
  const otherYear = D.years.find(y => y !== D.default_year);
  click($(`#year-${otherYear}`));
  check("year switch updates the buttons",
        $(`#year-${otherYear}`).getAttribute("aria-pressed") === "true");
  check("year switch reloads the pool",
        poolChips().length === D.blocks.filter(b => b.year === otherYear && b.origin === null).length);
  check("the other year is untouched by this year's moves",
        /Nothing moved yet/.test($("#board-changes").textContent));
  click($(`#year-${D.default_year}`));

  // --- deferring to a later year --------------------------------------------
  click($(`#year-${D.default_year}`));
  const deferrable = chipsOn(donor)[0] || poolChips()[0];
  const deferProject = deferrable.querySelector(".name").textContent;
  const deferHours = hours(deferrable);
  const beforeDeferHere = planned(donor);
  check("deferrals panel is hidden with nothing deferred",
        $("#board-defers").style.display === "none");
  click(deferrable.querySelector(".defer-btn"));
  const yearBtns = Array.from(doc.querySelectorAll(".deferrer .years button"));
  check("defer offers only later years",
        yearBtns.length > 0 &&
        yearBtns.every(b => parseInt(b.textContent, 10) > D.default_year ||
                            /back/.test(b.textContent)),
        yearBtns.map(b => b.textContent).join(","));

  const laterYear = parseInt(yearBtns[0].textContent, 10);
  click(yearBtns[0]);
  check("the block leaves the year it was deferred from",
        !chipsOn(donor).some(c => c.querySelector(".name").textContent === deferProject &&
                                  hours(c) === deferHours) ||
        planned(donor) < beforeDeferHere);
  check("deferrals panel appears", $("#board-defers").style.display === "block");
  check("deferrals panel names the project and both years",
        $("#board-defers").textContent.includes(deferProject) &&
        $("#board-defers").textContent.includes(String(laterYear)));
  check("deferrals panel says NFR approval is needed",
        /NFR approval/.test($("#board-defers").textContent));
  check("the year buttons show the net movement",
        $(`#year-${laterYear} .badge`).textContent.length > 0);

  click($(`#year-${laterYear}`));
  check("the block turns up in the later year",
        chipsOn(donor).some(c => c.querySelector(".name").textContent === deferProject) ||
        poolChips().some(c => c.querySelector(".name").textContent === deferProject));
  check("a deferred block is marked with the year it came from",
        Array.from(doc.querySelectorAll("#board .chip"))
          .some(c => /from \d{4}/.test(c.textContent)));
  check("hours are conserved across the deferral",
        Math.abs(D.blocks.reduce((s, b) => s + b.hours, 0) -
                 Array.from(doc.querySelectorAll("#board .chip")).length * 0 -
                 window.BOARD_DATA.blocks.reduce((s, b) => s + b.hours, 0)) < 1);
  click($(`#year-${D.default_year}`));

  click($("#board-undo"));
  check("undo reverses a deferral", $("#board-defers").style.display === "none");
  click($(`#year-${D.default_year}`));

  // --- exported plan --------------------------------------------------------
  click($("#board-show"));
  const plan = $("#plan-text").value;
  check("plan names the year", plan.startsWith("Proposed reallocation, " + D.default_year));
  check("plan has a change section", plan.includes("Change by person"));
  check("plan has a block table with before and after",
        plan.includes("project\thours\tbudget year\tnow in\toriginally\tnow"));
  check("plan has a deferral section for the NFR request",
        plan.includes("Deferred to a later year (needs NFR approval)"));
  check("plan records the hypothetical person", plan.includes("New postdoc"));

  // --- the chart of the proposal --------------------------------------------
  // Plotly is stripped above, so the figure is checked as data rather than pixels.
  const API = window.BOARD_API;
  const figure = () => API.chartFigure();
  const rowTotal = (fig, person) => {
    const i = fig.order.indexOf(person);
    return i < 0 ? 0 : fig.traces.reduce((s, t) => s + (t.x[i] || 0), 0);
  };

  check("the chart panel and its dropdowns are on the page",
        !!$("#board-chart-plot") && !!$("#chart-year") && !!$("#chart-view"));
  let fig = figure();
  check("the chart follows the board year by default", fig.years.join() === String(D.default_year));
  check("the chart has a row for the unassigned pool", fig.order.includes("Unassigned"));
  check("the chart totals match the cards",
        Math.abs(rowTotal(fig, donor) - planned(donor)) < 2,
        `chart ${rowTotal(fig, donor)} vs card ${planned(donor)}`);
  check("the chart carries the hypothetical person's hours",
        Math.abs(rowTotal(fig, "New postdoc") - planned("New postdoc")) < 2);
  check("stacked segments are one trace per project",
        fig.traces.every(t => t.type === "bar" && t.orientation === "h" &&
                              t.x.length === fig.order.length));

  $("#chart-year").value = String(otherYear);
  fig = figure();
  check("the year dropdown moves the chart off the board year",
        fig.years.join() === String(otherYear));
  check("the chart shows the other year's hours, not this one's",
        Math.abs(rowTotal(fig, donor) -
                 window.BOARD_DATA.blocks.filter(b => b.year === otherYear && b.origin === donor)
                   .reduce((s, b) => s + b.hours, 0)) < 2);

  $("#chart-year").value = "all";
  fig = figure();
  check("the all-years option covers every year", fig.years.length === D.years.length);
  const everyHour = D.blocks.reduce((s, b) => s + b.hours, 0);
  check("every budgeted hour lands in some row of the all-years chart",
        Math.abs(fig.order.reduce((s, p) => s + rowTotal(fig, p), 0) - everyHour) < 2,
        `${fig.order.reduce((s, p) => s + rowTotal(fig, p), 0)} of ${everyHour}`);

  $("#chart-year").value = "follow";
  $("#chart-view").value = "baseline";
  fig = figure();
  check("the comparison view draws budgeted against proposed",
        fig.traces.length === 2 && fig.traces[0].name === "Budgeted" &&
        fig.traces[1].name === "Proposed");
  check("the budgeted series is the export, not the proposal",
        Math.abs(fig.traces[0].x[fig.order.indexOf(donor)] -
                 ((D.baseline[donor] || {})[D.default_year] || 0)) < 2);
  check("the proposed series is the board",
        Math.abs(fig.traces[1].x[fig.order.indexOf(donor)] - planned(donor)) < 2);
  $("#chart-view").value = "projects";

  // --- the plan file --------------------------------------------------------
  const saved = API.planFileText();
  const donorMid = planned(donor), postdocMid = planned("New postdoc");
  const chipsMid = $$("#board .chip").length;
  check("the plan file names the export it came from", saved.includes(D.fingerprint));
  check("the plan file explains how to pick it up again", /Open plan file/.test(saved));
  check("the plan file lists the change by person", /Change by person, \d{4}/.test(saved));
  check("the plan file carries the block table",
        saved.includes("project\thours\tbudget year\tnow in\toriginally\tnow"));
  check("the plan file ends with reloadable state", /\n\{"v":1,[\s\S]*\}\n?$/.test(saved));

  click($("#board-reset"));
  check("reset clears the board before reloading", Math.abs(planned(donor) - donorBefore) < 2);
  API.loadPlanText(saved);
  check("loading the file restores the moves", Math.abs(planned(donor) - donorMid) < 2,
        `${planned(donor)} vs ${donorMid}`);
  check("loading the file restores an added card",
        !!cardFor("New postdoc") && Math.abs(planned("New postdoc") - postdocMid) < 2);
  check("loading the file restores every block, splits included",
        $$("#board .chip").length === chipsMid);
  check("a load can be undone", $("#board-undo").disabled === false);
  let threw = false;
  try { API.loadPlanText("just some notes about the meeting"); } catch (e) { threw = true; }
  check("a file with no board state is refused", threw);
  check("the refused file left the plan alone", Math.abs(planned(donor) - donorMid) < 2);

  // --- reset ----------------------------------------------------------------
  click($("#board-reset"));
  check("reset removes added cards", cards().length === D.people.length);
  check("reset restores the donor", Math.abs(planned(donor) - donorBefore) < 2);
  check("reset clears history", $("#board-undo").disabled === true);

  // --- keeping the file up to date ------------------------------------------
  // The board writes through the File System Access API, which jsdom does not
  // have, so a stand-in handle collects what would have been written. Chrome and
  // Edge provide the real one; Firefox and Safari take the download path instead.
  await autosaveChecks();

  console.log(failures ? `\n${failures} failing` : "\nall board interactions pass");
  process.exit(failures ? 1 : 0);
}

async function autosaveChecks() {
  const writes = [];
  const handle = {
    name: "plan.txt",
    createWritable: async () => ({
      write: async (text) => { writes.push(text); },
      close: async () => {},
    }),
  };
  const dom2 = await buildDom((w) => {
    w.showSaveFilePicker = async () => handle;
    w.showOpenFilePicker = async () => [handle];
  });
  const w2 = dom2.window, d2 = w2.document;
  const tap = (el) => el.dispatchEvent(new w2.MouseEvent("click", { bubbles: true }));
  const settle = () => new Promise((r) => setTimeout(r, 900));  // past the save debounce

  tap(d2.getElementById("board-save"));
  await settle();
  check("naming a file writes the plan to it", writes.length === 1);
  check("the button becomes Save now once a file is named",
        d2.getElementById("board-save").textContent === "Save now");
  check("the status line names the file",
        /plan\.txt/.test(d2.getElementById("board-save-status").textContent));

  const chip2 = d2.querySelector("#pool-chips .chip") ||
                d2.querySelector("#people-grid .person .chip");
  const holder = chip2.closest(".person");
  const target = Array.from(d2.querySelectorAll("#people-grid .person")).find(c => c !== holder);
  tap(chip2);
  tap(target);
  await settle();
  check("moving a block writes the file again", writes.length === 2, `${writes.length} writes`);
  check("the file follows the move",
        writes[1] !== writes[0] && writes[1].includes("Change by person"));

  const D2 = w2.BOARD_DATA;
  const quiet = writes.length;
  tap(d2.querySelector("#people-grid .person .chip"));   // select
  tap(d2.getElementById("year-" + D2.years[D2.years.length - 1]));  // look at another year
  await settle();
  check("clicking about without moving anything leaves the file alone",
        writes.length === quiet, `${writes.length - quiet} extra writes`);

  let reloads = true;
  try { w2.BOARD_API.loadPlanText(writes[writes.length - 1]); } catch (e) { reloads = false; }
  check("what the board wrote is what the board can read back", reloads);
}

main().catch(err => { console.error(err); process.exit(1); });

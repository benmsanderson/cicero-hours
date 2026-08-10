// Exercises the allocation board's JS in jsdom: initial render, moving committed
// hours between people, splitting, capacity feedback, undo, adding a card, the
// change summary, the exported plan, and reset.
const fs = require("fs");
const { JSDOM } = require("jsdom");

const path = process.argv[2];
if (!path) {
  console.error("usage: node tests/board_check.js <dashboard.html>\n" +
                "build one first, e.g. python tests/build_fixture_dashboard.py /tmp/fixture.html");
  process.exit(2);
}
const html = fs.readFileSync(path, "utf8");
// Strip the plotly bundle: it is megabytes of canvas code jsdom cannot run.
const stripped = html.replace(/<script>[\s\S]*?Plotly[\s\S]*?<\/script>/, "<script></script>");

const dom = new JSDOM(stripped, { runScripts: "dangerously", pretendToBeVisual: true });
const { window } = dom;
const doc = window.document;
const $ = (s) => doc.querySelector(s);
const $$ = (s) => Array.from(doc.querySelectorAll(s));
const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const hours = (chip) => parseFloat(chip.querySelector(".hrs").textContent.replace(/[^\d.]/g, ""));

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log("  ok   " + name);
  else { console.log("  FAIL " + name + (extra ? "  <- " + extra : "")); failures++; }
}

const D = window.BOARD_DATA;
const guide = D.billable_hours;
console.log(`board data: ${D.people.length} people, ${D.blocks.length} blocks, ` +
            `guide ${guide} h, opens on ${D.default_year}`);

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
check("change summary shows a baseline arrow", /\u2192/.test(changes));

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

// --- exported plan --------------------------------------------------------
click($("#board-show"));
const plan = $("#plan-text").value;
check("plan names the year", plan.startsWith("Proposed reallocation, " + D.default_year));
check("plan has a change section", plan.includes("Change by person"));
check("plan has a block table with before and after",
      plan.includes("year\tproject\thours\toriginally\tnow"));
check("plan records the hypothetical person", plan.includes("New postdoc"));

// --- reset ----------------------------------------------------------------
click($("#board-reset"));
check("reset removes added cards", cards().length === D.people.length);
check("reset restores the donor", Math.abs(planned(donor) - donorBefore) < 2);
check("reset clears history", $("#board-undo").disabled === true);

console.log(failures ? `\n${failures} failing` : "\nall board interactions pass");
process.exit(failures ? 1 : 0);

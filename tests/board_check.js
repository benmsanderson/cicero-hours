// Exercises the allocation board's JS in jsdom: initial render, click-to-assign,
// splitting a block, returning a block, switching year, and the exported plan.
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

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log("  ok   " + name);
  else { console.log("  FAIL " + name + (extra ? "  <- " + extra : "")); failures++; }
}

const D = window.BOARD_DATA;
console.log(`board data: ${D.people.length} people, ${D.blocks.length} blocks, ` +
            `target ${D.billable_hours} h, opens on ${D.default_year}`);

// --- initial render -------------------------------------------------------
check("board panel rendered", $("#people-grid").children.length === D.people.length,
      `${$("#people-grid").children.length} cards`);
check("opens on the year with the most unassigned time",
      $(`#year-${D.default_year}`).getAttribute("aria-pressed") === "true");

const poolChipsFor = () => $$("#pool-chips .chip");
const startCount = poolChipsFor().length;
const expectedStart = D.blocks.filter(b => b.year === D.default_year).length;
check("pool holds this year's blocks", startCount === expectedStart,
      `${startCount} vs ${expectedStart}`);

const totalText = () => $("#board-total").textContent;
const firstTotal = totalText();
check("total line reports unassigned hours", /unassigned in/.test(firstTotal));

// --- click to assign ------------------------------------------------------
const chip = poolChipsFor()[0];
const chipName = chip.querySelector(".name").textContent;
const chipHours = chip.querySelector(".hrs").textContent;
click(chip);
check("clicking a block selects it",
      $$("#pool-chips .chip").some(c => c.getAttribute("aria-selected") === "true"));

const targetCard = $("#people-grid .person");
const targetPerson = targetCard.querySelector("h3").textContent;
click(targetCard);
check("clicking a person moves the block out of the pool",
      poolChipsFor().length === startCount - 1);
const moved = $$("#people-grid .person")[0].querySelectorAll(".chip");
check("the block lands on that person",
      Array.from(moved).some(c => c.querySelector(".name").textContent === chipName));
check("the person's numbers update", /\d/.test($(".person .numbers").textContent));
check("total line changed", totalText() !== firstTotal);

// --- capacity bar ---------------------------------------------------------
const overCards = $$(".person").filter(c => /over/.test(c.querySelector(".numbers").textContent));
console.log(`  note ${overCards.length} of ${D.people.length} cards are over the standard`);
check("every card draws a target rule", $$(".person .bar .target").length === D.people.length);
const widths = $$(".person .bar .committed").map(s => parseFloat(s.style.width));
check("committed widths are finite percentages",
      widths.every(w => Number.isFinite(w) && w >= 0 && w <= 100));

// --- return it ------------------------------------------------------------
click(moved[0].querySelector(".x"));
check("the x control returns a block to the pool", poolChipsFor().length === startCount);

// --- split ----------------------------------------------------------------
const splitTarget = poolChipsFor()[0];
const beforeHours = parseFloat(splitTarget.querySelector(".hrs").textContent.replace(/[^\d.]/g, ""));
click(splitTarget.querySelector(".split-btn"));
check("split control opens an input", !!$("#pool-chips .splitter input"));
const input = $("#pool-chips .splitter input");
input.value = "100";
click($("#pool-chips .splitter button"));
check("splitting adds a block", poolChipsFor().length === startCount + 1);
const sameProject = poolChipsFor()
  .filter(c => c.querySelector(".name").textContent === chipName)
  .map(c => parseFloat(c.querySelector(".hrs").textContent.replace(/[^\d.]/g, "")));
check("split conserves hours",
      Math.abs(sameProject.reduce((a, b) => a + b, 0) - beforeHours) < 1.5,
      `${sameProject.join(" + ")} vs ${beforeHours}`);

// --- year switch ----------------------------------------------------------
const otherYear = D.years.find(y => y !== D.default_year);
click($(`#year-${otherYear}`));
check("year switch updates the button state",
      $(`#year-${otherYear}`).getAttribute("aria-pressed") === "true");
check("year switch reloads the pool",
      poolChipsFor().length === D.blocks.filter(b => b.year === otherYear).length ||
      $("#pool-chips .empty") !== null);
check("total line follows the year", totalText().includes(String(otherYear)));

// --- plan text ------------------------------------------------------------
click($("#board-show"));
const plan = $("#plan-text").value.split("\n");
check("plan has a header and every block", plan.length === D.blocks.length + 2,
      `${plan.length} lines`);
check("plan header names the columns", plan[0] === "year\tproject\thours\tassigned to");
check("unplaced blocks are marked", plan.slice(1).some(r => r.endsWith("UNASSIGNED")));

// --- reset ----------------------------------------------------------------
click($("#board-reset"));
click($(`#year-${D.default_year}`));
check("reset restores the original blocks", poolChipsFor().length === startCount);

console.log(failures ? `\n${failures} failing` : "\nall board interactions pass");
process.exit(failures ? 1 : 0);

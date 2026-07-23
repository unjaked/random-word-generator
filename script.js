"use strict";

const WORDLISTS = Object.freeze({
  long: Object.freeze({
    url: "eff_large_wordlist.txt",
    size: 7776,
    minLength: 3,
    maxLength: 9,
    defaultMaxLength: 7,
    defaultWordCount: 5,
  }),
  short: Object.freeze({
    url: "eff_short_wordlist_1.txt",
    size: 1296,
    minLength: 3,
    maxLength: 5,
    defaultMaxLength: 5,
    defaultWordCount: 5,
  }),
});
const RANDOM_SEPARATORS = [" ", "-", "_", ".", ","];
const DEFAULT_FORMATTING = Object.freeze({
  caseStyle: "capitalize",
  separator: "none",
  customSeparator: "/",
});

const elements = {
  form: document.querySelector("#settingsForm"),
  wordListToggle: document.querySelector("#wordListToggle"),
  wordListInputs: document.querySelectorAll('input[name="wordList"]'),
  minLength: document.querySelector("#minLength"),
  maxLength: document.querySelector("#maxLength"),
  wordCount: document.querySelector("#wordCount"),
  caseStyle: document.querySelector("#caseStyle"),
  separator: document.querySelector("#separator"),
  customSeparator: document.querySelector("#customSeparator"),
  customSeparatorField: document.querySelector("#customSeparatorField"),
  result: document.querySelector("#result"),
  generateButton: document.querySelector("#generateButton"),
  copyButton: document.querySelector("#copyButton"),
  copyLabel: document.querySelector("#copyLabel"),
  resetButton: document.querySelector("#resetButton"),
  status: document.querySelector("#status"),
  securityTitle: document.querySelector("#security-title"),
  securityMeter: document.querySelector("#securityMeter"),
  meterFill: document.querySelector("#meterFill"),
  securityDetail: document.querySelector("#securityDetail"),
};

let words = [];
let wordsByLength = new Map();
let eligibleWords = [];
let activeWordList = "short";
let loadedWordLists = new Map();
let copyResetTimer;

function parseWordlist(text) {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/)[1])
    .filter((word) => /^[a-z-]+$/.test(word));
}

function indexWordsByLength(wordList) {
  const index = new Map();

  for (const word of wordList) {
    const length = word.length;
    if (!index.has(length)) index.set(length, []);
    index.get(length).push(word);
  }

  return index;
}

async function loadWordList(key) {
  const config = WORDLISTS[key];
  const response = await fetch(config.url);
  if (!response.ok) throw new Error(`${key} word list request failed with ${response.status}`);

  const wordList = parseWordlist(await response.text());
  if (wordList.length !== config.size || new Set(wordList).size !== config.size) {
    throw new Error(`The EFF ${key} word list did not pass its integrity checks.`);
  }

  return {
    words: wordList,
    wordsByLength: indexWordsByLength(wordList),
  };
}

function activateWordList(key) {
  const data = loadedWordLists.get(key);
  if (!data) return;

  const config = WORDLISTS[key];
  activeWordList = key;
  words = data.words;
  wordsByLength = data.wordsByLength;

  elements.minLength.min = String(config.minLength);
  elements.minLength.max = String(config.maxLength);
  elements.maxLength.min = String(config.minLength);
  elements.maxLength.max = String(config.maxLength);
  elements.minLength.value = String(config.minLength);
  elements.maxLength.value = String(config.defaultMaxLength);
  elements.wordCount.value = String(config.defaultWordCount);

  updateSecurityMeter();
  generatePhrase();
}

function readInteger(input, fallback) {
  const value = Number.parseInt(input.value, 10);
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function getSettings() {
  const config = WORDLISTS[activeWordList];
  return {
    minLength: clamp(
      readInteger(elements.minLength, config.minLength),
      config.minLength,
      config.maxLength
    ),
    maxLength: clamp(
      readInteger(elements.maxLength, config.defaultMaxLength),
      config.minLength,
      config.maxLength
    ),
    wordCount: clamp(readInteger(elements.wordCount, config.defaultWordCount), 1, 50),
    caseStyle: elements.caseStyle.value,
    separator: elements.separator.value,
    customSeparator: elements.customSeparator.value,
  };
}

function getEligibleWords(minLength, maxLength) {
  const pool = [];
  for (let length = minLength; length <= maxLength; length += 1) {
    const bucket = wordsByLength.get(length);
    if (bucket) pool.push(...bucket);
  }
  return pool;
}

function secureRandomIndex(size) {
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new RangeError("The random selection pool must contain at least one item.");
  }

  const range = 0x1_0000_0000;
  const unbiasedLimit = range - (range % size);
  const randomValue = new Uint32Array(1);

  do {
    crypto.getRandomValues(randomValue);
  } while (randomValue[0] >= unbiasedLimit);

  return randomValue[0] % size;
}

function applyCase(word, style) {
  if (style === "upper") return word.toUpperCase();
  if (style === "capitalize") return word[0].toUpperCase() + word.slice(1);
  if (style === "random" && secureRandomIndex(2) === 1) {
    return word[0].toUpperCase() + word.slice(1);
  }
  return word;
}

function separatorFor(style, customValue) {
  const separators = {
    space: " ",
    hyphen: "-",
    underscore: "_",
    period: ".",
    comma: ",",
    newline: "\n",
    none: "",
    custom: customValue,
  };

  if (style === "random") {
    return RANDOM_SEPARATORS[secureRandomIndex(RANDOM_SEPARATORS.length)];
  }
  return separators[style] ?? " ";
}

function joinWords(wordList, settings) {
  if (settings.separator !== "random") {
    return wordList.join(separatorFor(settings.separator, settings.customSeparator));
  }

  return wordList.reduce((phrase, word, index) => {
    if (index === 0) return word;
    return phrase + separatorFor("random", settings.customSeparator) + word;
  }, "");
}

function formattingEntropy(settings) {
  const caseBits = settings.caseStyle === "random" ? settings.wordCount : 0;
  const separatorBits = settings.separator === "random" && settings.wordCount > 1
    ? (settings.wordCount - 1) * Math.log2(RANDOM_SEPARATORS.length)
    : 0;

  return caseBits + separatorBits;
}

function entropyFor(settings, poolSize) {
  if (poolSize === 0) return 0;
  return settings.wordCount * Math.log2(poolSize) + formattingEntropy(settings);
}

function strengthFor(bits) {
  if (bits < 40) return { label: "Low", color: "var(--weak)" };
  if (bits < 60) return { label: "Moderate", color: "var(--moderate)" };
  if (bits < 75) return { label: "Strong", color: "var(--strong)" };
  return { label: "Very strong", color: "var(--very-strong)" };
}

function superscriptNumber(value) {
  const digits = "⁰¹²³⁴⁵⁶⁷⁸⁹";
  return String(value).replace(/\d/g, (digit) => digits[Number(digit)]);
}

function formatCombinationCount(bits) {
  const count = 2 ** bits;
  if (count < 1e15) return Math.round(count).toLocaleString("en-US");

  const exponent = Math.floor(Math.log10(count));
  const mantissa = count / (10 ** exponent);
  return `${mantissa.toFixed(2)} × 10${superscriptNumber(exponent)}`;
}

function updateSecurityMeter() {
  if (words.length === 0) return;

  const settings = getSettings();
  const validRange = settings.minLength <= settings.maxLength;
  eligibleWords = validRange ? getEligibleWords(settings.minLength, settings.maxLength) : [];
  const bits = entropyFor(settings, eligibleWords.length);
  const strength = strengthFor(bits);
  const meterPercent = clamp(bits, 0, 100);

  elements.generateButton.disabled = eligibleWords.length === 0;
  elements.securityTitle.textContent = validRange ? strength.label : "Invalid range";
  elements.securityTitle.style.color = validRange ? strength.color : "var(--weak)";
  elements.meterFill.style.width = `${meterPercent}%`;
  elements.meterFill.style.background = validRange ? strength.color : "var(--weak)";
  elements.securityMeter.setAttribute("aria-valuenow", String(Math.round(meterPercent)));
  elements.securityMeter.setAttribute(
    "aria-valuetext",
    validRange ? `${strength.label} passphrase security` : "Invalid word length range"
  );

  if (!validRange) {
    elements.securityDetail.textContent = "Minimum length must not exceed maximum length.";
    return;
  }

  elements.securityDetail.textContent =
    `Approximately ${formatCombinationCount(bits)} possible combinations generable with current settings.`;
}

function generatePhrase() {
  const settings = getSettings();
  if (eligibleWords.length === 0) return;

  const selectedWords = Array.from({ length: settings.wordCount }, () => {
    const word = eligibleWords[secureRandomIndex(eligibleWords.length)];
    return applyCase(word, settings.caseStyle);
  });

  elements.result.value = joinWords(selectedWords, settings);
  elements.copyButton.disabled = false;
  window.clearTimeout(copyResetTimer);
  elements.status.classList.remove("copy-feedback");
  elements.status.textContent = "";
  elements.copyLabel.textContent = "Copy";
}

async function copyResult() {
  const value = elements.result.value;
  if (!value) return;

  try {
    await navigator.clipboard.writeText(value);
  } catch {
    elements.result.focus();
    elements.result.select();
    document.execCommand("copy");
    window.getSelection()?.removeAllRanges();
  }

  window.clearTimeout(copyResetTimer);
  elements.copyLabel.textContent = "Copied";
  elements.status.textContent = "Copied to clipboard.";
  elements.status.classList.remove("copy-feedback");
  void elements.status.offsetWidth;
  elements.status.classList.add("copy-feedback");
  copyResetTimer = window.setTimeout(() => {
    elements.copyLabel.textContent = "Copy";
    elements.status.classList.remove("copy-feedback");
    elements.status.textContent = "";
  }, 1250);
}

function handleSettingsChange(event) {
  if (event.target.name === "wordList") {
    activateWordList(event.target.value);
    return;
  }

  if (event.target === elements.separator) {
    elements.customSeparatorField.hidden = elements.separator.value !== "custom";
  }
  updateSecurityMeter();
  generatePhrase();
}

function restoreDefaultSettings() {
  const shortListInput = Array.from(elements.wordListInputs)
    .find((input) => input.value === "short");
  shortListInput.checked = true;
  elements.caseStyle.value = DEFAULT_FORMATTING.caseStyle;
  elements.separator.value = DEFAULT_FORMATTING.separator;
  elements.customSeparator.value = DEFAULT_FORMATTING.customSeparator;
  elements.customSeparatorField.hidden = true;
  activateWordList("short");
}

function normalizeNumericInput(event) {
  const input = event.target;
  const minimum = Number.parseInt(input.min, 10);
  const maximum = Number.parseInt(input.max, 10);
  const normalizedValue = String(clamp(readInteger(input, minimum), minimum, maximum));

  if (input.value !== normalizedValue) {
    input.value = normalizedValue;
    updateSecurityMeter();
    generatePhrase();
  }
}

async function initialize() {
  if (!window.crypto?.getRandomValues) {
    elements.result.value = "Your browser does not support secure random generation.";
    elements.status.textContent = "Web Crypto is required.";
    return;
  }

  try {
    const entries = await Promise.all(
      Object.keys(WORDLISTS).map(async (key) => [key, await loadWordList(key)])
    );
    loadedWordLists = new Map(entries);
    elements.generateButton.disabled = false;
    elements.resetButton.disabled = false;
    elements.wordListToggle.disabled = false;
    activateWordList("short");
  } catch (error) {
    console.error(error);
    elements.result.value = "The local word lists could not be loaded.";
    elements.status.textContent = "Serve the site through GitHub Pages or a local web server.";
  }
}

elements.form.addEventListener("input", handleSettingsChange);
elements.minLength.addEventListener("blur", normalizeNumericInput);
elements.maxLength.addEventListener("blur", normalizeNumericInput);
elements.wordCount.addEventListener("blur", normalizeNumericInput);
elements.generateButton.addEventListener("click", generatePhrase);
elements.copyButton.addEventListener("click", copyResult);
elements.resetButton.addEventListener("click", restoreDefaultSettings);
initialize();

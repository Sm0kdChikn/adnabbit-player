(() => {
  const form = document.getElementById("setup-form");
  const apiInput = document.getElementById("api-base");
  const codeInput = document.getElementById("claim-code");
  const errorEl = document.getElementById("error");
  const successEl = document.getElementById("success");
  const btn = document.getElementById("connect-btn");

  function showError(msg) {
    successEl.hidden = true;
    errorEl.hidden = !msg;
    errorEl.textContent = msg || "";
  }

  function showSuccess(msg) {
    errorEl.hidden = true;
    successEl.hidden = !msg;
    successEl.textContent = msg || "";
  }

  codeInput.addEventListener("input", () => {
    // Keep 6 chars; allow alphanumeric claim codes from portal
    const cleaned = codeInput.value.replace(/\s+/g, "").slice(0, 6);
    if (cleaned !== codeInput.value) codeInput.value = cleaned;
    showError("");
  });

  apiInput.addEventListener("input", () => showError(""));

  async function boot() {
    if (!window.adnabbit?.getSetupState) {
      showError("Bridge missing — restart the app.");
      return;
    }
    const state = await window.adnabbit.getSetupState();
    apiInput.value = state.apiBase || state.defaultApiBase || "http://127.0.0.1:3000";
    if (state.paired) {
      showSuccess(
        state.screenName
          ? `Already paired as ${state.screenName}. Opening player…`
          : "Already paired. Opening player…"
      );
    }
    codeInput.focus();
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    showError("");
    showSuccess("");

    const apiBase = apiInput.value.trim();
    const code = codeInput.value.trim();
    if (!apiBase) {
      showError("Enter the API base URL.");
      return;
    }
    if (!code || code.length < 4) {
      showError("Enter the 6-digit claim code from the portal.");
      return;
    }

    btn.disabled = true;
    btn.textContent = "Connecting…";
    try {
      const result = await window.adnabbit.claimWithCode({ apiBase, code });
      if (result?.error) {
        showError(result.error);
        return;
      }
      const name = result?.screenName || "screen";
      showSuccess(`Paired as ${name}. Starting player…`);
      // Main process transitions to player after successful claim
    } catch (err) {
      showError(err?.message || "Claim failed");
    } finally {
      btn.disabled = false;
      btn.textContent = "Connect / Claim";
    }
  });

  boot();
})();

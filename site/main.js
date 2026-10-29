// The copy buttons, and the visitor's own system preselected. The toggle itself is plain CSS.
const status = document.getElementById("copy-status");
document.querySelectorAll("[data-copy]").forEach((button) => {
  button.addEventListener("click", async () => {
    const text = document.querySelector(`#${button.dataset.copy} code`).textContent;
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = status.textContent = "Copied";
    } catch {
      status.textContent = "Couldn't copy; select the command and copy it.";
    }
    setTimeout(() => { button.textContent = "Copy"; status.textContent = ""; }, 2000);
  });
});
// An iPad reports "MacIntel" too; it's the one with a touch screen.
const mobile = /Android|iPhone|iPad/.test(navigator.userAgent) || navigator.maxTouchPoints > 1;
const os = /Mac/.test(navigator.platform) ? "macos" : /Linux/.test(navigator.platform) ? "linux" : null;
if (os && !mobile) document.querySelector(`input[value="${os}"]`).checked = true;

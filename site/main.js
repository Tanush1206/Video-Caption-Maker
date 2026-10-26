// The copy buttons, and Linux preselected on Linux and macOS. The toggle itself is plain CSS.
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
if (/Linux|Mac/.test(navigator.platform) && !/Android|iPhone|iPad/.test(navigator.userAgent)) {
  document.querySelector('input[value="linux"]').checked = true;
}

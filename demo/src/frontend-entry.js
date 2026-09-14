// Interface selection is a URL choice, never an API-health or demo-login decision.
export function frontendEntry(search){return new URLSearchParams(search).get('mode')==='live'?'legacy':'current';}

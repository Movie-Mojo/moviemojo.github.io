async function securitySettings() {
  const factors=checked(await db.auth.mfa.listFactors());
  const verified=factors.totp.filter(factor=>factor.status==="verified");
  openModal(`${settingsBack()}<h2>Security</h2><section class="settings-section"><h3>Password</h3><p class="muted">Change your password while staying signed in.</p><form id="change-password-form" class="settings-form"><label for="current-password">Current password</label><input id="current-password" type="password" autocomplete="current-password" required><label for="settings-new-password">New password</label><input id="settings-new-password" type="password" autocomplete="new-password" minlength="8" required><label for="confirm-password">Confirm new password</label><input id="confirm-password" type="password" autocomplete="new-password" minlength="8" required><div id="password-nonce-wrap" hidden><label for="password-nonce">Email verification code</label><input id="password-nonce" inputmode="numeric" autocomplete="one-time-code"></div><p id="password-status" role="status" class="muted"></p><button class="button">Change password</button></form></section><section class="settings-section"><h3>Two-factor authentication</h3><p class="muted">${verified.length ? "Enabled. Your authenticator code is required after password sign-in." : "Add an authenticator app for an extra layer of account protection."}</p>${verified.map(factor=>`<div class="factor-row"><span>${esc(factor.friendly_name || "Authenticator app")}</span><button class="link-button" data-remove-factor="${esc(factor.id)}">Remove</button></div>`).join("")}<button id="enroll-authenticator" class="button secondary full">${verified.length ? "Add backup authenticator" : "Set up authenticator"}</button><p class="muted security-recovery">Keep a backup authenticator on another device. If you lose every authenticator, contact the site owner for identity-verified recovery.</p></section>`);
  bindSettingsBack();
  $("#change-password-form").onsubmit=e=>{e.preventDefault();run(e.target.querySelector("button"),async()=>{
    const form=e.target, password=$("#settings-new-password").value, current=$("#current-password").value;
    if(password!==$("#confirm-password").value) throw Error("New passwords do not match.");
    if(password===current) throw Error("Choose a different new password.");
    const attributes={password,current_password:current};
    if($("#password-nonce").value) attributes.nonce=$("#password-nonce").value.trim();
    const result=await db.auth.updateUser(attributes);
    if(result.error?.code === "reauthentication_needed") {
      checked(await db.auth.reauthenticate());
      $("#password-nonce-wrap").hidden=false;$("#password-nonce").required=true;
      $("#password-status").textContent="Enter the verification code sent to your email, then submit again.";
      return;
    }
    checked(result);form.reset();$("#password-nonce-wrap").hidden=true;$("#password-nonce").required=false;
    $("#password-status").textContent="Password updated. You are still signed in.";toast("Password updated.");
  });};
  $("#enroll-authenticator").onclick=e=>run(e.currentTarget,enrollAuthenticator);
  modal.querySelectorAll("[data-remove-factor]").forEach(button=>button.onclick=()=>removeAuthenticator(button.dataset.removeFactor));
}
async function enrollAuthenticator() {
  const enrollment=checked(await db.auth.mfa.enroll({factorType:"totp",friendlyName:"Movie Mojo "+new Date().toISOString().slice(0,19).replace("T"," ")}));
  if(!enrollment.totp?.qr_code?.startsWith("data:image/svg+xml")) {
    await db.auth.mfa.unenroll({factorId:enrollment.id});throw Error("Could not generate an authenticator QR code.");
  }
  openModal(`${settingsBack()}<h2>Set up authenticator</h2><p>Scan this QR code with your authenticator app, then enter its six-digit code.</p><img class="mfa-qr" src="${esc(enrollment.totp.qr_code)}" alt="Authenticator setup QR code"><details class="mfa-manual"><summary>Enter setup key manually</summary><code>${esc(enrollment.totp.secret)}</code></details><form id="enroll-mfa-form" class="settings-form"><label for="enroll-mfa-code">Authentication code</label><input id="enroll-mfa-code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required><button class="button">Verify and enable</button><button id="cancel-enrollment" type="button" class="button secondary">Cancel</button><p id="enrollment-error" class="form-error" role="alert"></p></form>`);
  let active=false;
  const cancel=async()=>{
    $("#modal-content").innerHTML="";
    if(!active) { active=true; checked(await db.auth.mfa.unenroll({factorId:enrollment.id})); }
  };
  modalDismissAction=cancel;
  $("#settings-back").onclick=async()=>{modalDismissAction=null;await run(null,cancel);settingsMenu();};
  $("#cancel-enrollment").onclick=()=>{closeModal();};
  $("#enroll-mfa-form").onsubmit=async e=>{
    e.preventDefault();const button=e.target.querySelector("button");button.disabled=true;$("#enrollment-error").textContent="";
    try {
      checked(await db.auth.mfa.challengeAndVerify({factorId:enrollment.id,code:$("#enroll-mfa-code").value.trim()}));
      active=true;modalDismissAction=null;$("#modal-content").innerHTML="";
      if(modal.open) await securitySettings();toast("Two-factor authentication enabled.");
    } catch(error) {if($("#enrollment-error")) $("#enrollment-error").textContent=error.message || "That code could not be verified. Try the current code.";}
    finally {button.disabled=false;}
  };
}
function removeAuthenticator(factorId) {
  openModal(`${settingsBack()}<h2>Remove authenticator</h2><p>Enter the current code from this authenticator to confirm removal.</p><form id="remove-mfa-form" class="settings-form"><label for="remove-mfa-code">Authentication code</label><input id="remove-mfa-code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required><button class="button danger">Remove authenticator</button></form>`);bindSettingsBack();
  $("#remove-mfa-form").onsubmit=e=>{e.preventDefault();run(e.target.querySelector("button"),async()=>{
    checked(await db.auth.mfa.challengeAndVerify({factorId,code:$("#remove-mfa-code").value.trim()}));
    checked(await db.auth.mfa.unenroll({factorId}));checked(await db.auth.refreshSession());
    closeModal();await initialize(state.user);
    if(!state.mfaRequired) await securitySettings();toast("Authenticator removed.");
  });};
}
function renderMfaLogin() {
  $("#navigation").hidden=true;
  app.innerHTML=`<section class="auth mfa-login"><p class="eyebrow">One more security check</p><h1>Verify it’s you.</h1><p class="subtitle">Enter the current six-digit code from your authenticator.</p><form id="mfa-login-form" class="settings-form">${state.mfaFactors.length>1 ? `<label for="mfa-login-factor">Authenticator</label><select id="mfa-login-factor">${state.mfaFactors.map(factor=>`<option value="${esc(factor.id)}">${esc(factor.friendly_name || "Authenticator app")}</option>`).join("")}</select>` : ""}<label for="mfa-login-code">Authentication code</label><input id="mfa-login-code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required><button class="button">Verify and continue</button><p id="mfa-login-error" class="form-error" role="alert"></p></form><p class="muted">Lost your authenticator? Use a backup authenticator or contact the site owner.</p><button id="logout" class="link-button">Sign out</button></section>`;
  $("#logout").onclick=logout;
  $("#mfa-login-form").onsubmit=async e=>{
    e.preventDefault();const button=e.target.querySelector("button");button.disabled=true;$("#mfa-login-error").textContent="";
    try {
      const factorId=$("#mfa-login-factor")?.value || state.mfaFactors[0]?.id;
      if(!factorId) throw Error("No verified authenticator found. Sign out and try again.");
      checked(await db.auth.mfa.challengeAndVerify({factorId,code:$("#mfa-login-code").value.trim()}));
      state.mfaRequired=false;await initialize(state.user);
    } catch(error) {$("#mfa-login-error").textContent=error.message || "Could not verify this code.";}
    finally {button.disabled=false;}
  };
}

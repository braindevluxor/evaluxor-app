---
target: landing (login page)
total_score: 26
max_score: 32
na_heuristics: 10
p0_count: 0
p1_count: 3
target_identity: "file:C:\\EvaLuxor\\src\\pages\\login\\LoginPage.tsx"
target_fingerprint: "sha256:45e7be438fddeb6231b88b56a228da87b9119d595d5876056f03340c5efa29f8"
target_path: "C:\\EvaLuxor\\src\\pages\\login\\LoginPage.tsx"
timestamp: 2026-10-13T12-54-21Z
slug: src-pages-login-loginpage-tsx
---
⚠️ DEGRADED: single-context (sub-agent tool blocked — nested-subagent depth limit reached at depth 1; Assessor A and B ran inline, sequentially, A finishing before any detector output entered context)

**Target:** `src/pages/login/LoginPage.tsx` (+ `src/components/auth/AuthShell.tsx`, `src/pages/login/RegisterPage.tsx`) — this app has no marketing landing; `HomeRedirect` at `/` sends unauthenticated visitors to `/login`, so the login page is the first and only public surface. Mode: **Operate** wrapped around a Persuade moment (every employee's daily front door).

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Spinner + disabled button + "Ingresando…" cover the happy path; no inline field validation, no caps-lock hint, and `HomeRedirect` renders `null` → unstyled blank flash before mount |
| 2 | Match System / Real World | 3 | Error copy in `AuthContext` is excellent and specific ("Te quedan N intentos…"), but the register slips between tuteo ("Ingresa el código") and voseo ("Revisá la consola") |
| 3 | User Control and Freedom | 2 | TOTP step is a one-way door — no "Volver"/cancel once the code screen shows; no password-recovery path anywhere |
| 4 | Consistency and Standards | 3 | Shared Button/Input/Field/Spinner used correctly; but inputs are `min-h-[38px]` while buttons are `min-h-[44px]`, and the focus ring is `ring-primary/20` (very faint for keyboard users) |
| 5 | Error Prevention | 3 | TOTP input strips non-digits and caps at 6, `autoComplete="one-time-code"`, password reveal toggle, "Recordarme" default-on; no caps-lock warning |
| 6 | Recognition Rather Than Recall | 3 | Labels, placeholders and the invite-only note remove guessing; but the Líder — the only route to access — is named without any way to reach them |
| 7 | Flexibility and Efficiency of Use | 3 | Real accelerators present: `autocomplete` username/current-password/one-time-code (password managers and OTP paste just work), persistent session via "Recordarme" |
| 8 | Aesthetic and Minimalist Design | 3 | Focused and uncluttered, but the minimalism is generic — see the specificity verdict |
| 9 | Error Recovery | 3 | Errors render beside the form, preserve entered data, and name the remedy ("El Líder debe desbloquearlo…"); the network catch-all leaks dev-speak ("Revisá la consola") |
| 10 | Help and Documentation | n/a | An invite-only internal entry form carries no help surface by design; nothing on-screen to document |
| **Total** | | **26/32** | **Good (81%)** |

Applicable maximum: 32 (heuristic 10 scored n/a).

## Design Specificity Verdict

**LLM assessment:** The login is competent but **category-interchangeable**. `AuthShell` is `bg-white`, one `max-w-sm` column, `text-slate-500` helper copy, and a `bg-primary` pill button — this exact screen would ship unchanged for a CRM, a helpdesk, or a payroll tool. The brand arrives only as `completo.webp` (3922×1598 lockup) stretched `w-full`, which at 384px renders ~156px tall: a big logo sitting in a white void, not a composed brand moment. Nothing on the page says *supermarket evaluation*: no store cue, no data/score motif, no color story beyond one button. The one screen every evaluator opens on their phone in a branch, every single shift, looks like a default.

**Deterministic scan:** `impeccable detect --json src/pages/login src/components/auth` → **0 findings, exit 0** — clean, no side-tab accents, no broken images, no slop patterns in the auth surface. The detector is functioning (a control scan of `src/pages` returned 2 findings: `border-l-4` side-tab in `BibliotecaPage.tsx:204` and an `<img>` in `conciliacionPublica.test.tsx:157` — both out of scope; the second is a test fixture, a false positive for this critique). The detector confirmed the surface's mechanical hygiene; it cannot see the specificity gap, which is the real problem here.

**Visual overlays:** None — no browser automation is exposed in this session, so no injection, no live server, no `[Human]` tab. Evidence is source-truth only.

## Overall Impression

Solid, honest engineering: real accessibility wins (`aria-pressed` on the reveal toggle, `autoComplete="one-time-code"`, keyboard-operable custom checkbox), genuinely humane error copy with attempt countdowns, and an accurate "invite-only" message that prevents a pointless sign-up hunt. What's missing is any point of view. The single biggest opportunity: make the front door feel like *EvaLuxor's* front door — the app's navy (`--color-primary: #28315F`, the same navy as `theme-color` and `PendientePage`'s `bg-primary` field) is defined but unused here, while `PendientePage` two routes away already uses a full-bleed brand background the login ignores.

## What's Working

1. **Error copy is better than most consumer apps.** "Contraseña incorrecta. Te quedan 2 intentos antes de quedar bloqueado" + a blocked-account message that names the exact remedy and the exact person who can fix it.
2. **The invite-only dead end is handled with dignity.** "¿No tienes cuenta? Solo se accede por invitación del Líder." sets expectations in one line instead of letting users hunt for a sign-up button that doesn't exist.
3. **The TOTP input is expertly constrained.** `maxLength={6}`, non-digits stripped on keystroke, `inputMode="numeric"`, `autoComplete="one-time-code"`, `autoFocus`, `tracking-[0.5em]` centered — the failure modes of 2FA entry are pre-empted, not just handled.

## Priority Issues

- **[P1] What**: No password or account recovery path on the landing. No "Olvidé mi contraseña" anywhere; the only remedy (Líder assigns a provisional password) is mentioned inside an error message after a failed attempt.
  **Why it matters**: A user who forgot their password — the most common login failure — hits a wall with no exit; retries until lockout, which the system actively punishes with a 3-attempt block.
  **Fix**: Add a "¿Olvidaste tu contraseña?" link beside "Recordarme" that opens a pre-filled mailto to the Líder (or a Supabase reset flow), and surface "Las cuentas las crea el Líder" as a visible line, not just an error state.
  **Suggested command**: `/impeccable clarify`

- **[P1] What**: The landing is brand-empty — category-interchangeable white-void composition; the brand appears only as an oversized stretched logo, and the app's own navy is unused.
  **Why it matters**: Daily front door for every evaluator and manager; a generic entry screen signals "generic tool" at the moment the product most needs to feel trustworthy and owned.
  **Fix**: Compose a real auth world using the identity already in the codebase: full-bleed `bg-primary` (as `PendientePage` already does) with the white card floated on it, `isotipo.webp` as a quiet mark, the wordmark at a deliberate display size rather than `w-full` stretch, one restrained store-evaluation motif. Keep the form itself exactly as it is.
  **Suggested command**: `/impeccable bolder`

- **[P1] What**: `index.html` viewport meta sets `maximum-scale=1.0`, blocking pinch-zoom on every screen including this one (WCAG 1.4.4).
  **Why it matters**: Low-vision users cannot zoom the first screen they meet; on a phone in a bright store aisle this decides whether they log in at all.
  **Fix**: Remove `maximum-scale=1.0`; verify reflow at 200% zoom.
  **Suggested command**: `/impeccable audit`

- **[P2] What**: The TOTP step is a one-way door. Once `pasoTotp` is true there is no "Volver" — only a browser refresh escapes.
  **Why it matters**: A user who signed in as the wrong account, or whose authenticator isn't beside them, is trapped; refreshing to escape a security step feels like breaking the app.
  **Fix**: Add a secondary "Volver" action in the TOTP form that clears `pasoTotp`/`totpPendiente` and returns to credentials, preserving the entered username.
  **Suggested command**: `/impeccable clarify`

- **[P2] What**: Copy register slips and leaks dev-speak: "Revisá la consola" (voseo + console reference) vs "Ingresa el código" (tuteo) vs the neutral "Las cuentas las crea el Líder".
  **Why it matters**: "Revisá la consola" is unactionable for a store evaluator and breaks the fourth wall of a polished product; the register mix sounds like two teams wrote it.
  **Fix**: Normalize to tuteo across the auth surface; replace the catch-all with "No pudimos conectar. Revisa tu conexión e inténtalo de nuevo."
  **Suggested command**: `/impeccable clarify`

## Persona Red Flags

**Jordan (First-Timer)**: Opens `/` and gets a blank `#f1f5f9` flash (`HomeRedirect` returns `null` while `loading`), then a white page with a large logo and two fields and zero context about what EvaLuxor is or why they were invited. The invite note names the Líder but offers no way to reach them, so a genuinely lost user has no next step.

**Riley (Stress Tester)**: Empty submit → browser-native `required` bubbles only, no app-level state. Wrong password → good countdown, but 3 attempts locks the account with only Líder-issued recovery — reachable in 15 seconds, no self-service. Pastes "12 3456😀" into TOTP → correctly stripped (good); 7-digit paste → silently truncated to 6 with no feedback. Double-click "Ingresar" → disables correctly (good). Refresh mid-TOTP → step survival depends on `totpPendiente` persistence, and there's no way back either way. Bare `/registro` → invitation wall with a working "Ir a iniciar sesión" escape (good).

**Casey (Distracted Mobile User)**: Inputs are `min-h-[38px]` — below the 44px touch minimum the app's own buttons honor (`min-h-[44px]`; `input[type=date]` was already patched to 44px elsewhere, so this is a known, half-fixed pattern). The password-reveal toggle is `p-1` on a `h-5 w-5` icon ≈ 28px — fiddly for a thumb. Zoom is blocked by the viewport meta, so a user who can't read `text-sm` labels at arm's length is stuck. Single-column layout and pill button otherwise suit one-handed use.

## Minor Observations

- `MarcaAuth` with `soloLogo` renders `alt="EvaLuxor"` and an `sr-only <h1>EvaLuxor</h1>` — screen readers announce the brand twice.
- The reveal toggle's hit area (~28px) is under the 44px guideline the rest of the app respects.
- `HomeRedirect` returning `null` during `loading` produces an unstyled blank flash at `/`; `AuthShell` would be a cheap Suspense fallback.
- The custom `sr-only` checkbox uses `peer` + `peer-focus-visible` correctly, but a native checkbox with `accent-color` would be less code for the same result.
- `completo.png` (110KB) and `completo.webp` (42KB) both ship in `public/` while only the webp is used — dead weight in the deploy.
- The TOTP "••••••" placeholder is visually near-identical to a filled state for a low-vision user.

## Questions to Consider

- What would this login look like if it were designed for someone standing in a supermarket aisle at 8am, phone in one hand, rather than for a developer with a password manager?
- The app already has a brand navy and a full-bleed brand treatment one route away (`PendientePage`) — why does the *first* screen get the white void instead?
- If lockout requires the Líder, why doesn't the screen that mentions the Líder also let you reach them?

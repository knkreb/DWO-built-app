// admin-users — v4.88 — Slice 1: User Identity
// See docs/specs/slice-1-user-identity.md §4
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ACTION_NAMES = [
  "create", "update", "deactivate", "reactivate", "email_change",
  "reset_password", "tid_change", "tid_change_by_user", "status_change",
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errText(msg: string, status = 400) {
  return json({ error: msg }, status);
}

async function writeAudit(
  admin: ReturnType<typeof createClient>,
  action: string,
  recordId: string,
  fieldName: string | null,
  oldValue: string | null,
  newValue: string | null,
  changedBy: string,
) {
  if (ACTION_NAMES.indexOf(action) < 0) throw new Error("invalid audit action: " + action);
  await admin.from("audit_log").insert({
    table_name: "profiles",
    record_id: recordId,
    action,
    field_name: fieldName,
    old_value: oldValue,
    new_value: newValue,
    changed_by: changedBy,
    changed_at: new Date().toISOString(),
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return errText("Method not allowed", 405);

  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return errText("Missing Authorization header", 401);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errText("Invalid JSON body");
  }
  const action = body?.action;
  if (!action) return errText("Missing action");

  // Service-role client for all privileged reads/writes.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Identify the caller from their JWT.
  const { data: callerAuth, error: callerAuthErr } = await admin.auth.getUser(jwt);
  if (callerAuthErr || !callerAuth?.user) return errText("Invalid session", 401);
  const caller = callerAuth.user;

  const { data: callerProfile } = await admin
    .from("profiles")
    .select("*")
    .eq("user_id", caller.id)
    .maybeSingle();

  const selfServiceActions = ["change_own_password", "set_own_tid"];
  if (selfServiceActions.indexOf(action) < 0) {
    if (!callerProfile || !callerProfile.active || callerProfile.template !== "admin") {
      return errText("Forbidden", 403);
    }
  } else {
    if (!callerProfile || !callerProfile.active) return errText("Forbidden", 403);
  }

  try {
    switch (action) {
      case "create_user": {
        const { email, display_name, template, color, temp_password, tid, make_technician } = body;
        if (!email || !display_name || !template || !temp_password) {
          return errText("email, display_name, template and temp_password are required");
        }
        if (["admin", "field"].indexOf(template) < 0) return errText("template must be 'admin' or 'field'");
        if (String(temp_password).length < 8) return errText("Password must be at least 8 characters");

        const { data: createdAuth, error: createAuthErr } = await admin.auth.admin.createUser({
          email,
          password: temp_password,
          email_confirm: true,
        });
        if (createAuthErr || !createdAuth?.user) {
          return errText(createAuthErr?.message || "Could not create login");
        }

        let technicianId: string | null = null;
        if (make_technician) {
          const { data: tech, error: techErr } = await admin
            .from("technicians")
            .insert({ name: display_name, color: color || "#3498db", tid: tid || null, active: true })
            .select()
            .single();
          if (techErr) return errText("Could not create technician: " + techErr.message);
          technicianId = tech.id;
        }

        const { data: profile, error: profileErr } = await admin
          .from("profiles")
          .insert({
            user_id: createdAuth.user.id,
            email,
            display_name,
            template,
            technician_id: technicianId,
            must_change_password: true,
            created_by: caller.email,
            modified_by: caller.email,
          })
          .select()
          .single();
        if (profileErr) return errText("Could not create profile: " + profileErr.message);

        await writeAudit(admin, "create", profile.id, null, null, display_name + " (" + email + ", " + template + ")", caller.email!);
        return json({ ok: true, profile });
      }

      case "reset_password": {
        const { profile_id, temp_password } = body;
        if (!profile_id || !temp_password) return errText("profile_id and temp_password are required");
        if (String(temp_password).length < 8) return errText("Password must be at least 8 characters");

        const { data: target } = await admin.from("profiles").select("*").eq("id", profile_id).maybeSingle();
        if (!target) return errText("User not found", 404);

        const { error: pwErr } = await admin.auth.admin.updateUserById(target.user_id, { password: temp_password });
        if (pwErr) return errText(pwErr.message);

        await admin.from("profiles").update({ must_change_password: true, modified_at: new Date().toISOString(), modified_by: caller.email }).eq("id", profile_id);
        await writeAudit(admin, "reset_password", profile_id, "password", null, null, caller.email!);
        return json({ ok: true });
      }

      case "change_email": {
        const { profile_id, new_email } = body;
        if (!profile_id || !new_email) return errText("profile_id and new_email are required");

        const { data: target } = await admin.from("profiles").select("*").eq("id", profile_id).maybeSingle();
        if (!target) return errText("User not found", 404);

        const { error: emailErr } = await admin.auth.admin.updateUserById(target.user_id, {
          email: new_email,
          email_confirm: true,
        });
        if (emailErr) return errText(emailErr.message);

        await admin.from("profiles").update({ email: new_email, modified_at: new Date().toISOString(), modified_by: caller.email }).eq("id", profile_id);
        await writeAudit(admin, "email_change", profile_id, "email", target.email, new_email, caller.email!);
        return json({ ok: true });
      }

      case "set_active": {
        const { profile_id, active } = body;
        if (!profile_id || typeof active !== "boolean") return errText("profile_id and active are required");

        const { data: target } = await admin.from("profiles").select("*").eq("id", profile_id).maybeSingle();
        if (!target) return errText("User not found", 404);
        if (target.id === callerProfile.id && !active) return errText("You can't deactivate yourself");

        if (!active) {
          await admin.auth.admin.updateUserById(target.user_id, { ban_duration: "876000h" });
          await admin.from("profiles").update({
            active: false,
            deactivated_at: new Date().toISOString(),
            deactivated_by: caller.email,
            modified_at: new Date().toISOString(),
            modified_by: caller.email,
          }).eq("id", profile_id);
          if (target.technician_id) {
            await admin.from("technicians").update({
              active: false,
              deleted_at: new Date().toISOString(),
              deleted_by: caller.email,
            }).eq("id", target.technician_id);
          }
          await writeAudit(admin, "deactivate", profile_id, "active", "true", "false", caller.email!);
        } else {
          await admin.auth.admin.updateUserById(target.user_id, { ban_duration: "none" });
          await admin.from("profiles").update({
            active: true,
            deactivated_at: null,
            deactivated_by: null,
            modified_at: new Date().toISOString(),
            modified_by: caller.email,
          }).eq("id", profile_id);
          if (target.technician_id) {
            await admin.from("technicians").update({
              active: true,
              deleted_at: null,
              deleted_by: null,
            }).eq("id", target.technician_id);
          }
          await writeAudit(admin, "reactivate", profile_id, "active", "false", "true", caller.email!);
        }
        return json({ ok: true });
      }

      case "change_own_password": {
        const { new_password } = body;
        if (!new_password) return errText("new_password is required");
        if (String(new_password).length < 8) return errText("Password must be at least 8 characters");

        const { error: pwErr } = await admin.auth.admin.updateUserById(caller.id, { password: new_password });
        if (pwErr) return errText(pwErr.message);

        await admin.from("profiles").update({
          must_change_password: false,
          modified_at: new Date().toISOString(),
          modified_by: caller.email,
        }).eq("id", callerProfile.id);
        await writeAudit(admin, "reset_password", callerProfile.id, "password", null, null, caller.email!);
        return json({ ok: true });
      }

      case "set_own_tid": {
        const { tid } = body;
        if (!callerProfile.technician_id) return errText("No technician linked to your login");

        const { data: tech } = await admin.from("technicians").select("id, name, tid").eq("id", callerProfile.technician_id).maybeSingle();
        if (!tech) return errText("Linked technician not found", 404);

        const newTid = (tid || "").trim() || null;
        const oldTid = tech.tid || null;
        if (newTid === oldTid) return json({ ok: true });

        await admin.from("technicians").update({ tid: newTid }).eq("id", tech.id);
        await writeAudit(admin, "tid_change_by_user", callerProfile.id, "tid", oldTid, newTid, caller.email!);

        const { data: settingRow } = await admin.from("settings").select("value").eq("key", "alert_tid_changed_enabled").maybeSingle();
        const alertsEnabled = !settingRow || settingRow.value !== "false";
        if (alertsEnabled) {
          const verb = !oldTid ? "set" : (!newTid ? "cleared" : "changed");
          const message = newTid
            ? (tech.name + " " + verb + " tracker ID" + (oldTid ? " from " + oldTid + " to " + newTid : " to " + newTid) + " on " + new Date().toLocaleString())
            : (tech.name + " cleared tracker ID (was " + oldTid + ") on " + new Date().toLocaleString());
          await admin.from("alerts").insert({
            alert_type: "tid_changed_by_user",
            severity: "warning",
            subject_table: "technicians",
            subject_id: tech.id,
            message,
            details: { old: oldTid, new: newTid },
          });
        }
        return json({ ok: true });
      }

      default:
        return errText("Unknown action");
    }
  } catch (e) {
    return errText(e instanceof Error ? e.message : "Unexpected error", 500);
  }
});

import type { Express, RequestHandler, Response } from "express";
import type { CloudflareAccessAssertionReader } from "../access-control/application/ports/cloudflare-access-assertion-reader.js";
import { createCloudflareAccessAssertionReader } from "./cloudflare-access-assertion-reader.js";
import type { AdministrativeRequestAdmission } from "./administrative-request-admission.js";
import {
  mapAdministrativeAccessControlError,
  rejectAdministrativeQuery,
  setAdministrativeSecurityHeaders,
  validateAdministrativeRequestHasNoBody,
  validateAdministrativeRequestTarget,
} from "./administrative-http.js";
import { HttpError } from "./errors/http-error.js";

export const ADMINISTRATIVE_DASHBOARD_ROUTE = "/admin";
export const ADMINISTRATIVE_DASHBOARD_ASSET_PREFIX = "/admin/assets/";

export interface ProtectedAdministrativeDashboard {
  readonly getAdministrativeDashboard: Readonly<{
    execute(): Promise<unknown>;
  }>;
}

export interface AdministrativeDashboardRouteDependencies {
  readonly admission: AdministrativeRequestAdmission;
  readonly createProtectedAdministration: (
    reader: CloudflareAccessAssertionReader,
  ) => ProtectedAdministrativeDashboard;
}

const ASSETS: Readonly<
  Record<string, Readonly<{ body: string; type: string }>>
> = Object.freeze({
  "app.js": Object.freeze({
    body: "const root=document.querySelector('#app'),services=document.querySelector('#services'),audit=document.querySelector('#audit'),status=document.querySelector('#status');async function readJson(path){const response=await fetch(path,{credentials:'same-origin',redirect:'error'});if(!response.ok)throw new Error('request_failed');return response.json()}function addText(parent,value){parent.append(document.createTextNode(typeof value==='string'?value:JSON.stringify(value)))}function renderServices(value){if(!services)return;services.replaceChildren();const list=value&&Array.isArray(value.services)?value.services:[];if(!list.length){addText(services,'No registered services.');return}for(const service of list){const article=document.createElement('article'),heading=document.createElement('h3'),summary=document.createElement('p');addText(heading,service.id);addText(summary,`${String(service.displayName)} — ${String(service.status)} — ${String(service.availability)}`);article.append(heading,summary);for(const operation of ['start','stop','restart']){const form=document.createElement('form');form.className='mutation';const label=document.createElement('label');addText(label,`${operation} confirmation`);const input=document.createElement('input');input.type='text';input.required=true;input.autocomplete='off';label.append(input);const button=document.createElement('button');button.type='submit';addText(button,operation);form.append(label,button);form.addEventListener('submit',event=>{event.preventDefault();button.disabled=true;void fetch(`/admin/services/${encodeURIComponent(String(service.id))}/actions/${operation}`,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({confirmation:input.value}),redirect:'error'}).then(async response=>{input.value='';if(!response.ok)throw new Error('operation_failed');await refresh()}).catch(()=>{input.value='';if(status)status.textContent='Operation failed; authoritative state was not assumed.'}).finally(()=>{button.disabled=false})});article.append(form)}services.append(article)}}function renderAudit(value){if(audit){audit.textContent='';addText(audit,value)}}async function refresh(){const [overview,serviceList,history]=await Promise.all([readJson('/admin/overview'),readJson('/admin/services'),readJson('/admin/event-history?limit=20')]);if(root)root.textContent=JSON.stringify(overview,null,2);renderServices(serviceList);renderAudit(history)}void refresh().catch(()=>{if(status)status.textContent='Administrative overview unavailable.'});\n",
    type: "application/javascript",
  }),
  "styles.css": Object.freeze({
    body: "body{font-family:system-ui,sans-serif;margin:0;background:#10141c;color:#f3f4f6}main{max-width:72rem;margin:auto;padding:1rem}section,article{background:#1b2330;padding:1rem;margin:1rem 0;border-radius:.5rem}pre{white-space:pre-wrap;overflow:auto}label{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}input,button{font:inherit;padding:.4rem;background:#10141c;color:inherit;border:1px solid #718096;border-radius:.25rem}button{cursor:pointer}button:disabled{cursor:wait;opacity:.6}.mutation{margin:.5rem 0}:focus-visible{outline:3px solid #75bfff;outline-offset:2px}@media (max-width:40rem){label{align-items:stretch;flex-direction:column}}\n",
    type: "text/css",
  }),
  "backup.js": Object.freeze({
    body: "const root=document.querySelector('#backups'),status=document.querySelector('#status');async function load(){if(!root)return;root.replaceChildren();const response=await fetch('/admin/backups/targets',{credentials:'same-origin',redirect:'error'});if(!response.ok)throw new Error('request_failed');const value=await response.json(),targets=Array.isArray(value.targets)?value.targets:[];if(!targets.length){root.append(document.createTextNode('No registered backup targets.'));return}for(const target of targets){const article=document.createElement('article'),heading=document.createElement('h3'),summary=document.createElement('p'),form=document.createElement('form'),label=document.createElement('label'),input=document.createElement('input'),button=document.createElement('button');heading.append(document.createTextNode(String(target.displayName||target.id)));summary.append(document.createTextNode(`${String(target.id)} — ${String(target.kind)} — ${String(target.scheduleMode)}`));label.append(document.createTextNode('Manual backup confirmation '));input.type='text';input.required=true;input.autocomplete='off';label.append(input);button.type='submit';button.append(document.createTextNode('Run backup'));form.append(label,button);form.addEventListener('submit',event=>{event.preventDefault();button.disabled=true;void fetch(`/admin/backups/targets/${encodeURIComponent(String(target.id))}/runs`,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({confirmation:input.value}),redirect:'error'}).then(response=>{input.value='';if(!response.ok)throw new Error('operation_failed');return load()}).catch(()=>{input.value='';if(status)status.textContent='Backup state could not be reread.'}).finally(()=>{button.disabled=false})});article.append(heading,summary,form);root.append(article)}const note=document.createElement('p');note.append(document.createTextNode('Retention and scheduling remain project-owned. Restoration is not supported.'));root.append(note)}void load().catch(()=>{if(status)status.textContent='Backup administration unavailable.'});\n",
    type: "application/javascript",
  }),
});

const HTML =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Atlas Manager</title><link rel="stylesheet" href="/admin/assets/styles.css"></head><body><main><h1>Atlas Manager</h1><p id="status" role="status">Loading administrative state…</p><section aria-labelledby="overview-heading"><h2 id="overview-heading">Overview</h2><pre id="app">Loading…</pre></section><section aria-labelledby="services-heading"><h2 id="services-heading">Services</h2><div id="services"></div></section><section aria-labelledby="availability-heading"><h2 id="availability-heading">Availability</h2><pre id="availability">Loading…</pre></section><section aria-labelledby="backup-heading"><h2 id="backup-heading">Backups</h2><p>Local-only managed backup targets and recent run metadata.</p><div id="backups"></div></section><section aria-labelledby="audit-heading"><h2 id="audit-heading">Audit</h2><pre id="audit">Loading…</pre></section><section aria-labelledby="safety-heading"><h2 id="safety-heading">Power safety</h2><p>Backend is mock. Power effects and the machine scheduler are disabled. The Linux helper is unused. Wake and shutdown controls are not available.</p></section></main><script src="/admin/assets/app.js" defer></script><script src="/admin/assets/backup.js" defer></script></body></html>\n';

const BACKUP_ASSET = String.raw`const root=document.querySelector('#backups'),status=document.querySelector('#status');async function read(path){const response=await fetch(path,{credentials:'same-origin',redirect:'error'});if(!response.ok)throw new Error('request_failed');return response.json()}function text(parent,value){parent.append(document.createTextNode(String(value)))}function form(parent,labelText,targetId,method,suffix,confirmation,policy){const form=document.createElement('form'),label=document.createElement('label'),input=document.createElement('input'),button=document.createElement('button');text(label,labelText+' confirmation');input.required=true;input.autocomplete='off';label.append(input);const policyInput=document.createElement('input');if(policy!==undefined){policyInput.value=JSON.stringify(policy);policyInput.required=true;policyInput.setAttribute('aria-label',labelText+' JSON');form.append(policyInput)}button.type='submit';text(button,labelText);form.append(label,button);form.addEventListener('submit',event=>{event.preventDefault();button.disabled=true;let body={confirmation:input.value};if(policy!==undefined){try{body.policy=JSON.parse(policyInput.value)}catch{body.policy=undefined}}void fetch('/admin/backups/targets/'+encodeURIComponent(String(targetId))+suffix,{method,credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(body),redirect:'error'}).then(async response=>{input.value='';if(!response.ok)throw new Error('operation_failed');await load()}).catch(()=>{input.value='';if(status)status.textContent='Backup state could not be reread.'}).finally(()=>{button.disabled=false})});parent.append(form)}async function load(){if(!root)return;const values=await Promise.all([read('/admin/backups/targets'),read('/admin/backups/runs?limit=20')]);const targets=Array.isArray(values[0].targets)?values[0].targets:[],runs=Array.isArray(values[1].runs)?values[1].runs:[];root.replaceChildren();if(!targets.length){text(root,'No registered backup targets.');return}for(const target of targets){const article=document.createElement('article'),heading=document.createElement('h3'),summary=document.createElement('p'),history=document.createElement('ul');text(heading,target.displayName||target.id);text(summary,String(target.id)+' — '+String(target.kind)+' — '+String(target.scheduleMode));for(const run of runs.filter(item=>item.targetId===target.id).slice(-5)){const item=document.createElement('li');text(item,String(run.runId)+' — '+String(run.status)+' — '+String(run.trigger));history.append(item)}article.append(heading,summary,history);form(article,'Manual backup',''+target.id,'POST','/runs','confirm_registered_backup_run');form(article,'Update schedule',''+target.id,'PUT','/schedule','confirm_registered_backup_schedule_update',{mode:'manual'});form(article,'Update retention',''+target.id,'PUT','/retention','confirm_registered_backup_retention_update',{keepLastSuccessful:1});form(article,'Prune retention',''+target.id,'POST','/retention/prunes','confirm_registered_backup_retention_prune');root.append(article)}text(root,'Local-only backups. Restoration is not supported.')}void load().catch(()=>{if(status)status.textContent='Backup administration unavailable.'});`;

export function registerAdministrativeDashboardRoutes(
  app: Express,
  dependencies: AdministrativeDashboardRouteDependencies,
): void {
  app.all(
    `${ADMINISTRATIVE_DASHBOARD_ROUTE}`,
    createShellHandler(dependencies),
  );
  app.all(
    `${ADMINISTRATIVE_DASHBOARD_ROUTE}/`,
    createShellHandler(dependencies),
  );
  app.all(
    `${ADMINISTRATIVE_DASHBOARD_ASSET_PREFIX}:asset`,
    createAssetHandler(dependencies),
  );
}

function createShellHandler(
  dependencies: AdministrativeDashboardRouteDependencies,
): RequestHandler {
  return createAdmissionHandler(dependencies, async (request, response) => {
    if (request.method !== "GET") {
      response.setHeader("Allow", "GET");
      throw new HttpError(405, "method_not_allowed", "Method Not Allowed");
    }
    validateAdministrativeRequestTarget(request.url);
    rejectAdministrativeQuery(request.url);
    validateAdministrativeRequestHasNoBody(request);
    await dependencies
      .createProtectedAdministration(
        createCloudflareAccessAssertionReader(request),
      )
      .getAdministrativeDashboard.execute();
    response.type("html").send(HTML);
  });
}

function createAssetHandler(
  dependencies: AdministrativeDashboardRouteDependencies,
): RequestHandler {
  return createAdmissionHandler(dependencies, async (request, response) => {
    if (request.method !== "GET") {
      response.setHeader("Allow", "GET");
      throw new HttpError(405, "method_not_allowed", "Method Not Allowed");
    }
    validateAdministrativeRequestTarget(request.url);
    rejectAdministrativeQuery(request.url);
    validateAdministrativeRequestHasNoBody(request);
    const asset = request.params.asset;
    if (typeof asset !== "string" || !Object.hasOwn(ASSETS, asset))
      throw new HttpError(404, "route_not_found", "Route not found");
    await dependencies
      .createProtectedAdministration(
        createCloudflareAccessAssertionReader(request),
      )
      .getAdministrativeDashboard.execute();
    const value =
      asset === "backup.js"
        ? { body: BACKUP_ASSET, type: "application/javascript" }
        : ASSETS[asset]!;
    response.type(value.type).send(value.body);
  });
}

function createAdmissionHandler(
  dependencies: AdministrativeDashboardRouteDependencies,
  process: (
    request: Parameters<RequestHandler>[0],
    response: Response,
  ) => Promise<void>,
): RequestHandler {
  return (request, response, next) => {
    setAdministrativeSecurityHeaders(response);
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; font-src 'none'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    const release = dependencies.admission.tryAdmit();
    if (release === undefined) {
      response.setHeader("Retry-After", "1");
      next(
        new HttpError(
          429,
          "administrative_request_limited",
          "Administrative request limit exceeded",
        ),
      );
      return;
    }
    void process(request, response)
      .catch((error) => next(mapError(error)))
      .finally(release);
  };
}

function mapError(error: unknown): HttpError {
  return error instanceof HttpError
    ? error
    : (mapAdministrativeAccessControlError(error) ??
        new HttpError(
          503,
          "administrative_dashboard_unavailable",
          "Administrative dashboard unavailable",
        ));
}

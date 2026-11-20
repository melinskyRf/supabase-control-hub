import { aggregate } from './capacity.mjs';

/** Groups are views, never additive totals: a shared project may appear in two accounts. */
export function resourceGroups(state, dimension, category, period = '') {
  const all = [...new Map(state.projects.map(p => [p.ref,p])).values()];
  const definitions = dimension === 'account'
    ? [...new Set(state.connections.map(c=>c.account_id))].map(id=>({id,name:id,refs:(state.projectConnections||[]).filter(link=>state.connections.some(c=>c.id===link.connection_id&&c.account_id===id)).map(link=>link.project_ref)}))
    : dimension === 'application'
    ? state.applications.map(app=>({id:app.id,name:app.name,refs:state.members.filter(m=>m.application_id===app.id).map(m=>m.project_ref)}))
    : dimension === 'project'
    ? all.map(p=>({id:p.ref,name:p.name,refs:[p.ref]}))
    : state.organizations.map(org=>({id:org.id,name:org.name,refs:all.filter(p=>p.organization_id===org.id).map(p=>p.ref)}));
  return definitions.map(group=>{
    const projects=all.filter(p=>group.refs.includes(p.ref));
    // An organization allowance cannot be attributed wholly to a subset of its projects.
    const limits=state.limits.filter(l=>l.scope!=='ORGANIZATION_LEVEL'||all.filter(p=>p.organization_id===l.resource_id).every(p=>group.refs.includes(p.ref)));
    return {id:group.id,name:group.name,...aggregate(projects,state.observations,limits,category,period)};
  });
}

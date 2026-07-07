import { get, set, del } from 'idb-keyval';

// Projects
export async function listProjects() {
  return (await get('projects')) || [];
}

export async function saveProject(project) {
  const ids = await listProjects();
  if (!ids.includes(project.id)) {
    await set('projects', [...ids, project.id]);
  }
  await set(`project:${project.id}`, project);
}

export function getProject(id) {
  return get(`project:${id}`);
}

export async function deleteProject(id) {
  const ids = await listProjects();
  await set('projects', ids.filter((p) => p !== id));
  await del(`project:${id}`);
  await del(`states:${id}`);
}

// Check states: one record per project holding {checkId: state}
// state = {selections, comment, reminder, nothingToSelect, done}
export async function getCheckStates(projectId) {
  return (await get(`states:${projectId}`)) || {};
}

export async function saveCheckState(projectId, checkId, state) {
  const states = await getCheckStates(projectId);
  states[checkId] = state;
  await set(`states:${projectId}`, states);
  return states;
}

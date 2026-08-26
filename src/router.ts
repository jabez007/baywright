import { createRouter, createWebHistory } from 'vue-router'

import ProjectView from './ProjectView.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'start', component: ProjectView },
    { path: '/project/:id/level/:levelId', name: 'project-level', component: ProjectView },
  ],
})

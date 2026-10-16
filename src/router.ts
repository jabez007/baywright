import { createRouter, createWebHistory } from 'vue-router'

import ProjectView from './ProjectView.vue'

export const router = createRouter({
  // Under `/baywright/` on GitHub Pages, and `/` everywhere else.
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'start', component: ProjectView },
    { path: '/project/:id/level/:levelId', name: 'project-level', component: ProjectView },
  ],
})

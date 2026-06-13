import { createRouter } from 'ugly-app/client';
import { pages } from '../shared/pages';
import { allPages } from './allPages';

export const { RouterProvider, RouterView, useRouter } = createRouter({
  pages,
  allPages,
});

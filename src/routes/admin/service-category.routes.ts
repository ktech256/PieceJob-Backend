import { Router } from 'express';
import * as categoryController from '../../controllers/admin/service-category.controller';

const router = Router();

router.get('/', categoryController.listCategories);
router.post('/', categoryController.createCategory);
router.patch('/:id', categoryController.updateCategory);
router.delete('/:id', categoryController.softDeleteCategory);
router.patch('/:id/toggle', categoryController.toggleCategoryStatus);

export default router;

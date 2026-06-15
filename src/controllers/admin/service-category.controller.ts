import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import ServiceCategory from '../../models/ServiceCategory';

export const listCategories = async (req: AuthRequest, res: Response) => {
  try {
    const categories = await ServiceCategory.find({ isDeleted: false }).sort({ sortOrder: 1 });
    res.status(200).json({ success: true, data: categories });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch categories', error });
  }
};

export const createCategory = async (req: AuthRequest, res: Response) => {
  try {
    const category = new ServiceCategory(req.body);
    await category.save();
    res.status(201).json({ success: true, data: category });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateCategory = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const category = await ServiceCategory.findByIdAndUpdate(id, req.body, { new: true });
    res.status(200).json({ success: true, data: category });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const softDeleteCategory = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    await ServiceCategory.findByIdAndUpdate(id, { isDeleted: true });
    res.status(200).json({ success: true, message: 'Category soft-deleted' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const toggleCategoryStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;
    const category = await ServiceCategory.findByIdAndUpdate(id, { isActive }, { new: true });
    res.status(200).json({ success: true, data: category });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const seedCategories = async () => {
    const defaultCategories = [
        { code: 'HDS', name: 'Home & Domestic Services (HDS)', sortOrder: 1 },
        { code: 'CSS', name: 'Care & Support Services (CSS)', sortOrder: 2 },
        { code: 'HMS', name: 'Handyman & Repairs Services (HMS)', sortOrder: 3 },
        { code: 'OPS', name: 'Outdoor & Property Services (OPS)', sortOrder: 4 },
        { code: 'LLS', name: 'Convenience & Lifestyle Services (LLS)', sortOrder: 5 },
        { code: 'TSS', name: 'Technology & Home Setup Services (TSS)', sortOrder: 6 }
    ];

    for (const cat of defaultCategories) {
        await ServiceCategory.findOneAndUpdate(
            { code: cat.code },
            { $set: { name: cat.name, sortOrder: cat.sortOrder }, $setOnInsert: { isActive: true, isDeleted: false } },
            { upsert: true }
        );
    }
    console.log('[SEED] Service Categories initialized and updated');
};

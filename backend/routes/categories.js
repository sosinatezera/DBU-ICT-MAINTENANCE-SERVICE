/**
 * routes/categories.js
 * Category CRUD — admin only
 */
const express  = require('express');
const router   = express.Router();
const Category = require('../models/Category');
const { authenticate } = require('../middleware/auth');
const { authorize }    = require('../middleware/authorize');
const { validateObjectId, validateRequired, validateLength, sanitizeString } = require('../middleware/validation');

router.get('/', authenticate, async (req, res, next) => {
  try { res.json({ success: true, data: await Category.find().sort({ name: 1 }) }); }
  catch (err) { next(err); }
});

router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, 'Category');
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const cat = await Category.findById(req.params.id);
    if (!cat) return res.status(404).json({ success: false, message: 'Category not found.' });
    res.json({ success: true, data: cat });
  } catch (err) { next(err); }
});

router.post('/', authenticate, authorize('ICT Admin'), async (req, res, next) => {
  try {
    const { name, description } = req.body;
    const nameErr = validateRequired(name, 'Name');
    if (nameErr) return res.status(422).json({ success: false, message: nameErr });

    const lenErr = validateLength(sanitizeString(name), 'Name', { min: 2, max: 100 });
    if (lenErr) return res.status(400).json({ success: false, message: lenErr });

    const cat = await Category.create({ name: sanitizeString(name), description: description || null });
    res.status(201).json({ success: true, message: 'Category created.', id: cat._id });
  } catch (err) { next(err); }
});

router.put('/:id', authenticate, authorize('ICT Admin'), async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, 'Category');
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    if (req.body.name) {
      const lenErr = validateLength(sanitizeString(req.body.name), 'Name', { min: 2, max: 100 });
      if (lenErr) return res.status(400).json({ success: false, message: lenErr });
      req.body.name = sanitizeString(req.body.name);
    }

    const cat = await Category.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!cat) return res.status(404).json({ success: false, message: 'Category not found.' });
    res.json({ success: true, message: 'Category updated.' });
  } catch (err) { next(err); }
});

router.delete('/:id', authenticate, authorize('ICT Admin'), async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, 'Category');
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const cat = await Category.findByIdAndDelete(req.params.id);
    if (!cat) return res.status(404).json({ success: false, message: 'Category not found.' });
    res.json({ success: true, message: 'Category deleted.' });
  } catch (err) { next(err); }
});

module.exports = router;

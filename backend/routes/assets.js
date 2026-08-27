const express = require('express');
const router  = express.Router();
const { getAllAssets, getAssetById, createAsset, updateAsset, deleteAsset } = require('../controllers/assetController');
const { authenticate } = require('../middleware/auth');
const { authorize }    = require('../middleware/authorize');

router.get('/',       authenticate, getAllAssets);
router.get('/:id',    authenticate, getAssetById);
router.post('/',      authenticate, authorize('ICT Admin'), createAsset);
router.put('/:id',    authenticate, authorize('ICT Admin'), updateAsset);
router.delete('/:id', authenticate, authorize('ICT Admin'), deleteAsset);

module.exports = router;

// if exports is an array, it will be the same like loading multiple files...
module.exports = require('cqrs-eventdenormalizer').defineCollection({
  collectionName: 'person' // optional, default is folder name
});

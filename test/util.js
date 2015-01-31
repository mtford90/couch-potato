module.exports = {
    /**
     * Dump the object using JSOn, ensuring readability.
     * @param obj
     * @returns {*}
     */
    prettyJson: function (obj) {
        return JSON.stringify(obj, null, 4);
    }
};
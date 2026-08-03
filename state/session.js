let activeUserFolder = "Guest";

module.exports = {
    getActiveUserFolder: () => activeUserFolder,
    setActiveUserFolder: (name) => { activeUserFolder = name; }
};
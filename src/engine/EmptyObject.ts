//https://stackoverflow.com/questions/679915/how-do-i-test-for-an-empty-javascript-object
function isEmptyObject(o: any): o is {} {
    return Object.entries(o).length === 0 && o.constructor === Object;
}




export { isEmptyObject }
